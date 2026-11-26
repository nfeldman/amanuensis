"""Cross-reference resolution.

Builds a global ID → relative-path map once per materialization, then walks
every page's model and gives each known ID in its text a working link. Code
spans and fenced code are left alone. No file is read or written here.

`resolve_model` walks the blocks and gives each inline text the links, names
and prefixes a line of prose is owed (store-only PLAN §3.2 step 4, §10). A
"line" there is what a line was on the page: a heading, a paragraph, a list
item, or one table row with all its cells.

The match pattern is built from the index's own keys, so any ID the store
holds links, whatever its shape (`B04-R6`, a lowercase `auth`), and nothing
the store does not hold is touched (PLAN §2.2 item 4). The same pass names a
subsystem beside its first mention on a page (item 3) and introduces a concern
code as "concern RC-2" (item 5).
"""
from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field, replace

from .page import (
    Abbr,
    Atlas,
    AtlasItem,
    AtlasRegion,
    Block,
    BoundaryDiagram,
    Chip,
    CodeSpan,
    ConcernChecklist,
    ConcernFamily,
    ConcernItem,
    CoverageIndex,
    CoverageRow,
    Details,
    Emph,
    EnumTable,
    Heading,
    Inline,
    Inlines,
    LifecycleTable,
    Link,
    List,
    ListItem,
    Marked,
    Page,
    Paragraph,
    Quote,
    Record,
    RecordList,
    RuntimeDiagram,
    RuntimeRow,
    Section,
    Strong,
    SummaryItem,
    SummaryList,
    Table,
    Text,
    Topology,
    TopologyEdge,
)
from .prose import _html_href, _plain
from .slugs import slugify


@dataclass
class XrefIndex:
    # id → (display, abs_target_path, human definition)
    entries: dict[str, tuple[str, str, str]]
    # subsystem id → name, printed beside a page's first mention of the id
    names: dict[str, str] = field(default_factory=dict)
    # id → record kind ("subsystem", "concern", "seam", "finding", "matrix")
    kinds: dict[str, str] = field(default_factory=dict)
    # Generated copy (page hints, "Use it when" sentences, terms lines) left
    # exactly as written: an ID-shaped word in it is not a mention.
    protected: tuple[str, ...] = ()
    _patterns: tuple[re.Pattern[str] | None, ...] | None = field(default=None, init=False, repr=False)

    def patterns(self) -> tuple[re.Pattern[str] | None, ...]:
        """The known IDs, the named IDs and the protected copy, each compiled once per index."""

        if self._patterns is None:
            self._patterns = (
                identifier_pattern(self.entries),
                identifier_pattern(self.names),
                re.compile(identifier_alternation(self.protected)) if self.protected else None,
            )
        return self._patterns


# "concern RC-2" already says what RC-2 is.
CONCERN_WORD_PAT = re.compile(r"(?i)\bconcerns?[\s*_]*$")


def identifier_alternation(ids: Iterable[str]) -> str:
    """An alternation of exact IDs, longest first, so `B-01x` beats `B-01`."""

    return "|".join(re.escape(i) for i in sorted(set(ids), key=lambda i: (-len(i), i)))


def identifier_pattern(ids: Iterable[str]) -> re.Pattern[str] | None:
    """A pattern for exactly these IDs, delimited as a whole token."""

    keys = [i for i in ids if i]
    if not keys:
        return None
    return re.compile(rf"(?<![\w-])({identifier_alternation(keys)})(?![\w-])")


def _is_self(target: str, from_page_rel: str) -> bool:
    return target == from_page_rel or target.split("#", 1)[0] == from_page_rel


def _relative(from_rel: str, to_rel: str) -> str:
    # Produce a POSIX-style relative path from one doc to another.
    from_parts = from_rel.split("/")[:-1]
    to_parts = to_rel.split("/")
    # Walk back common prefix.
    common = 0
    while common < len(from_parts) and common < len(to_parts) - 1 and from_parts[common] == to_parts[common]:
        common += 1
    up = [".."] * (len(from_parts) - common)
    down = to_parts[common:]
    return "/".join(up + down) if (up or down) else to_rel


# ---------------------------------------------------------------------------
# The same resolution over the page model.
# ---------------------------------------------------------------------------

_OPAQUE = "\x00"


def _flat(nodes: Iterable[Inline]) -> str:
    """The text a reader sees in a line's nodes; code and chips are opaque, as the text pass held them."""

    out: list[str] = []
    for node in nodes:
        if isinstance(node, Text):
            out.append(node.text)
        elif isinstance(node, Link):
            out.append(f"[{node.label}]")
        elif isinstance(node, Abbr):
            out.append(node.text)
        elif isinstance(node, Strong | Emph):
            out.append(_flat(node.children))
        elif isinstance(node, CodeSpan | Chip):
            out.append(_OPAQUE)
        # A break, a tag, an anchor or a marker holds no words.
    return "".join(out)


def _plain_of(nodes: Iterable[Inline]) -> str:
    """The plain text of nodes, as the parser reads it off the Markdown they came from."""

    out: list[str] = []
    for node in nodes:
        if isinstance(node, Text | CodeSpan | Abbr):
            out.append(node.text)
        elif isinstance(node, Link):
            out.append(node.label)
        elif isinstance(node, Strong | Emph):
            out.append(_plain_of(node.children))
        elif isinstance(node, Chip):
            out.append(node.value)
    return "".join(out).strip()


def _merge(nodes: Iterable[Inline]) -> tuple[Inline, ...]:
    """Adjacent text nodes as one, as the parser gives them."""

    out: list[Inline] = []
    for node in nodes:
        if isinstance(node, Text) and not node.text:
            continue
        if isinstance(node, Text) and out and isinstance(out[-1], Text):
            out[-1] = Text(out[-1].text + node.text)
        elif isinstance(node, Strong | Emph):
            out.append(replace(node, children=_merge(node.children)))
        else:
            out.append(node)
    return tuple(out)


@dataclass(frozen=True)
class _Toggle(Text):
    """A page's own ID in the middle of a strong run.

    The text pass wrote it as `**ID**` inside `**...**`, which closes the run before
    it and reopens it after, so the ID is plain text between two strong runs. The
    model prints that as it always printed: the run is split at the ID.
    """


@dataclass
class _Walk:
    """One page's resolution: the index, the page's path and the IDs already named."""

    rel_path: str
    index: XrefIndex
    named: set[str] = field(default_factory=set)

    def line(
        self,
        cells: list[Inlines],
        *,
        plain: bool = False,
        header_row: bool = False,
        table: bool = False,
        keyed: bool = False,
    ) -> list[Inlines]:
        """Resolve the cells of one line. A table row is one line; its cells share what it names.

        `keyed`: the first cell is a record's heading, whose ID is the record's
        own name, so a concern code there is not prefixed with "concern".
        """

        index = self.index
        if not index.entries:
            return cells
        ids, inner, protected = index.patterns()
        offsets: list[int] = []
        at = 0
        for cell in cells:
            offsets.append(at)
            at += len(_flat(cell.nodes)) + len(" | ")
        text = " | ".join(_flat(cell.nodes) for cell in cells)
        named = self.named

        def print_name(id_: str, shown: str) -> str:
            named.add(id_)
            return f" ({shown})"

        def name_after(id_: str, start: int, end: int, label: str = "") -> str:
            name = index.names.get(id_)
            if name is None or id_ in named:
                return ""
            shown = name.replace("|", "/")
            whole_line = shown in text
            if plain or table:
                if whole_line:
                    named.add(id_)
                return "" if plain or whole_line else print_name(id_, shown)
            if shown in label:
                named.add(id_)
                return ""
            after, before = text[end:], text[:start]
            if re.match(r"[\s*_)\]:,(\u2014\u2013-]*" + re.escape(shown), after) or re.search(
                re.escape(shown) + r"[\s*_\[(:,\u2014\u2013-]*$", before
            ):
                named.add(id_)
                return ""
            return print_name(id_, shown)

        def concern_label(id_: str, start: int) -> bool:
            return (
                not header_row
                and not (keyed and len(offsets) > 1 and start < offsets[1])
                and not (keyed and len(offsets) == 1)
                and index.kinds.get(id_) == "concern"
                and not CONCERN_WORD_PAT.search(text[:start])
            )

        def in_text(
            value: str, base: int, strong: bool, edge: tuple[bool, bool] | None = None
        ) -> tuple[list[Inline], str]:
            """The nodes for one run of text, and the name its last mention owes after the run."""

            parts: list[Inline] = []
            owed = ""
            pos = 0
            guarded = [(m.start(), m.end()) for m in protected.finditer(value)] if protected else []
            assert ids is not None
            for match in ids.finditer(value):
                start, end = match.start(1), match.end(1)
                if any(a <= start < b for a, b in guarded):
                    continue
                id_ = match.group(1)
                if start > pos:
                    parts.append(Text(value[pos:start]))
                suffix = name_after(id_, base + start, base + end)
                concern = concern_label(id_, base + start)
                label = f"concern {id_}" if concern else id_
                target = index.entries[id_][1]
                if _is_self(target, self.rel_path):
                    # An ID on its own page is strong text, never a link to itself.
                    if not strong:
                        parts.append(Strong((Text(label),)))
                    elif edge is None or (start == 0 and edge[0]) or (end == len(value) and edge[1]):
                        parts.append(Text(label))
                    else:
                        parts.append(_Toggle(label))
                else:
                    parts.append(Link(_html_href(_relative(self.rel_path, target)), label))
                owed = ""
                if suffix:
                    parts.append(Text(suffix))
                    owed = suffix if end == len(value) else ""
                pos = end
            if pos < len(value):
                parts.append(Text(value[pos:]))
            return parts, owed

        def nodes_of(
            nodes: tuple[Inline, ...], base: int, strong: bool, direct: bool = False
        ) -> tuple[list[Inline], str]:
            out: list[Inline] = []
            owed = ""
            for number, node in enumerate(nodes):
                width = len(_flat((node,)))
                last = number == len(nodes) - 1
                here = ""
                if isinstance(node, Text):
                    parts, here = in_text(
                        node.text, base, strong, (number == 0, last) if direct else None
                    )
                    out.extend(parts)
                elif isinstance(node, Link):
                    label = node.label.strip("*")
                    if concern_label(label, base):
                        children = (Text("concern "), *node.children) if node.children else ()
                        node = replace(node, label="concern " + node.label, children=children)
                    if label in index.names:
                        suffix = name_after(label, base, base + width)
                    else:
                        hit = inner.search(label) if inner else None
                        suffix = name_after(hit.group(1), base, base + width, label) if hit else ""
                    out.append(node)
                    if suffix:
                        out.append(Text(suffix))
                        here = suffix
                elif isinstance(node, Strong | Emph):
                    children, inside = nodes_of(
                        node.children, base, strong or isinstance(node, Strong), isinstance(node, Strong)
                    )
                    if any(isinstance(child, _Toggle) for child in children):
                        runs: list[Inline] = []
                        run: list[Inline] = []
                        for child in children:
                            if isinstance(child, _Toggle):
                                if run:
                                    runs.append(Strong(tuple(run)))
                                    run = []
                                runs.append(Text(child.text))
                            else:
                                run.append(child)
                        if run:
                            runs.append(Strong(tuple(run)))
                        out.extend(runs)
                        here = inside
                    elif inside and isinstance(node, Strong) and children and children[-1] == Text(inside):
                        # The name follows the closing mark, not the id inside it.
                        out.append(replace(node, children=tuple(children[:-1])))
                        out.append(Text(inside))
                        here = inside
                    else:
                        out.append(replace(node, children=tuple(children)))
                        here = inside
                else:
                    out.append(node)
                base += width
                owed = here if last else ""
            return out, owed

        resolved: list[Inlines] = []
        for number, cell in enumerate(cells):
            nodes, _owed = nodes_of(cell.nodes, offsets[number], False)
            merged = _merge(nodes)
            resolved.append(cell if merged == cell.nodes else Inlines(merged, _plain_of(merged)))
        return resolved

    def inlines(self, text: Inlines, **kind: bool) -> Inlines:
        return self.line([text], **kind)[0]

    def blocks(self, blocks: tuple[Block, ...]) -> tuple[Block, ...]:
        return tuple(self.block(block) for block in blocks)

    def items(self, items: tuple[ListItem, ...]) -> tuple[ListItem, ...]:
        out: list[ListItem] = []
        for item in items:
            text = self.inlines(item.text)
            children = tuple(replace(child, items=self.items(child.items)) for child in item.children)
            out.append(replace(item, text=text, children=children))
        return tuple(out)

    def table(self, block: Table | EnumTable | LifecycleTable) -> Table | EnumTable | LifecycleTable:
        headers = self.line(list(block.headers), plain=True, header_row=True, table=True)
        rows = tuple(
            replace(row, cells=tuple(self.line(list(row.cells), table=True))) for row in block.rows
        )
        return replace(block, headers=tuple(headers), rows=rows)

    def block(self, block: Block) -> Block:
        if isinstance(block, Heading):
            return replace(block, text=self.inlines(block.text, plain=True))
        if isinstance(block, Paragraph | Quote):
            return replace(block, text=self.inlines(block.text))
        if isinstance(block, List):
            return replace(block, items=self.items(block.items))
        if isinstance(block, Table | EnumTable | LifecycleTable):
            return self.table(block)
        if isinstance(block, Section):
            resolved = self.blocks(block.blocks)
            lead, first = block.blocks[:1], resolved[:1]
            slug = block.slug
            if (
                lead
                and isinstance(lead[0], Heading)
                and isinstance(first[0], Heading)
                and first[0].text.plain != lead[0].text.plain
                and slug == slugify(lead[0].text.plain)
            ):
                # The section is named by its heading's words, concern prefix and all, and
                # its tables are captioned by that name.
                slug = slugify(first[0].text.plain)
                was, now = block.slug.replace("-", " "), slug.replace("-", " ")
                resolved = tuple(
                    replace(item, caption=now) if getattr(item, "caption", None) == was else item
                    for item in resolved
                )
            return replace(block, slug=slug, blocks=resolved)
        if isinstance(block, Details | Marked):
            return replace(block, blocks=self.blocks(block.blocks))
        if isinstance(block, SummaryList):
            items: list[SummaryItem] = []
            for item in block.items:
                key, value = self.line([item.key, item.value], table=True)
                items.append(replace(item, key=key, value=value))
            return replace(block, items=tuple(items))
        if isinstance(block, RecordList):
            records: list[Record] = []
            for record in block.records:
                # A record is the table row it was read from: one line, its cells in order.
                cells = [
                    record.key,
                    *([record.lede] if record.lede is not None else []),
                    *(fact.value for fact in record.facts),
                    *(field_.value for field_ in record.fields),
                ]
                resolved = iter(self.line(cells, table=True, keyed=True))
                key = next(resolved)
                lede = next(resolved) if record.lede is not None else None
                facts = tuple(replace(fact, value=next(resolved)) for fact in record.facts)
                content = tuple(replace(field_, value=next(resolved)) for field_ in record.fields)
                named = {}
                if key != record.key:
                    # The names a record is labelled and anchored by are read off its key as
                    # linked (a concern code in a heading carries no "concern" prefix).
                    key_text = _plain_of(key.nodes) or record.key_text
                    anchor = (
                        re.sub(r"^concern\s+", "", key_text) if block.kind == "concern-disposition" else key_text
                    )
                    named = {
                        "key_text": key_text,
                        "slug_text": _plain(f"{block.kind}-{anchor}"),
                        "path": _plain_of(key.nodes),
                    }
                records.append(replace(record, key=key, lede=lede, facts=facts, fields=content, **named))
            return replace(block, records=tuple(records))
        if isinstance(block, Atlas):
            regions: list[AtlasRegion] = []
            for region in block.regions:
                atlas_items: list[AtlasItem] = []
                for item in region.items:
                    cell, depth = self.line([item.subsystem, item.depth], table=True)
                    atlas_items.append(replace(item, subsystem=cell, depth=depth))
                regions.append(replace(region, items=tuple(atlas_items)))
            return replace(block, regions=tuple(regions))
        if isinstance(block, Topology):
            edges: list[TopologyEdge] = []
            for edge in block.edges:
                cells = [edge.left, edge.key, edge.right, edge.qualifier, edge.detail]
                left, key, right, qualifier, detail = self.line(cells, table=True)
                edges.append(
                    replace(edge, left=left, key=key, right=right, qualifier=qualifier, detail=detail)
                )
            return replace(block, edges=tuple(edges))
        if isinstance(block, RuntimeDiagram):
            runtime: list[RuntimeRow] = []
            for row in block.rows:
                cells = [row.source, row.language, row.target, row.mechanism, row.note]
                source, language, target, mechanism, note = self.line(cells, table=True)
                runtime.append(
                    replace(row, source=source, language=language, target=target, mechanism=mechanism, note=note)
                )
            return replace(block, rows=tuple(runtime))
        if isinstance(block, CoverageIndex):
            # A row opens with its subsystem's ID and name; the ID links to the subsystem
            # unless this is its own page, and the row names it for the rest of the page.
            coverage: list[CoverageRow] = []
            for line in block.rows:
                hit = self.index.entries.get(line.subsystem_id)
                href = line.href
                if hit and not _is_self(hit[1], self.rel_path):
                    href = _html_href(_relative(self.rel_path, hit[1]))
                if line.subsystem_id in self.index.names:
                    self.named.add(line.subsystem_id)
                coverage.append(replace(line, href=href))
            return replace(block, rows=tuple(coverage))
        if isinstance(block, ConcernChecklist):
            families: list[ConcernFamily] = []
            for family in block.families:
                items: list[ConcernItem] = []
                for item in family.items:
                    # A checklist row is one line: code, category, territory, probe, subsystems.
                    cells = [
                        item.code,
                        Inlines((Text(family.name),), family.name),
                        Inlines((Text(family.territory),), family.territory),
                        item.probe,
                        item.primary_subsystems,
                    ]
                    code, _category, _territory, probe, where = self.line(cells, table=True)
                    named = {}
                    if code != item.code:
                        code_text = _plain_of(code.nodes) or item.code_text
                        named = {"code_text": code_text, "slug_text": _plain(f"concern-checklist-{code_text}")}
                    items.append(replace(item, code=code, probe=probe, primary_subsystems=where, **named))
                families.append(replace(family, items=tuple(items)))
            return replace(block, families=tuple(families))
        if isinstance(block, BoundaryDiagram):
            # The rows name their subsystems in full, so the page counts both ends as named.
            for boundary in block.rows:
                for id_ in (boundary.subsystem_id, boundary.other_id):
                    if id_ in self.index.names:
                        self.named.add(id_)
            return block
        return block


def resolve_model(page: Page, rel_path: str, index: XrefIndex) -> Page:
    """Link every known ID in one page's model.

    `rel_path` is the page's plan path, which the index's targets are relative
    to. Run over a renderer's fresh model, never over a model already resolved.
    """

    walk = _Walk(rel_path, index)
    # The title is the page's first heading line, which the text pass read: it
    # names its own subject, so a page about B-01 counts B-01 as named.
    title = walk.inlines(Inlines((Text(page.title),), page.title), plain=True)
    return replace(page, title=title.plain, blocks=walk.blocks(page.blocks))
