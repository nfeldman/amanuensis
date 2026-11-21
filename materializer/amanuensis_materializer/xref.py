"""Cross-reference resolution.

Builds a global ID → relative-path map once per materialization, then
passes over every page's rendered Markdown, held in memory, and replaces bare
IDs with working links. Respects fenced code blocks (leaves IDs inside them
alone). No file is read or written here (store-only PLAN §3.2 step 3).

A page a renderer builds as a model is resolved by `resolve_model`, which walks
the blocks and gives each inline text the same links, names and prefixes the
text pass gives a line (store-only PLAN §3.2 step 4, §10). A "line" there is
what a line was in the Markdown: a heading, a paragraph, a list item, or one
table row with all its cells.

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
from .prose import _html_href
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
    _pattern: re.Pattern[str] | None = field(default=None, init=False, repr=False)

    def link(self, id_: str, from_page_rel: str) -> str | None:
        hit = self.entries.get(id_)
        if not hit:
            return None
        display, target, _definition = hit
        # Never self-link: an ID whose canonical page IS the current
        # page should render as bold text, not a link-to-self.
        # We also suppress anchor-only self-links (target starts with
        # the same relative path and differs only by #fragment).
        if _is_self(target, from_page_rel):
            return f"**{display}**"
        rel = _relative(from_page_rel, target)
        return f"[{display}]({rel})"

    def pattern(self) -> re.Pattern[str] | None:
        """Existing Markdown links, or a known ID with any bold around it."""

        if self._pattern is None and self.entries:
            ids = identifier_alternation(self.entries)
            self._pattern = re.compile(
                r"(?P<link>\[(?P<label>[^\]]*)\]\([^)]*\))(?P<lpost>\*\*)?"
                rf"|(?P<pre>\*\*)?(?<![\w-])(?P<id>{ids})(?![\w-])(?P<post>\*\*)?"
            )
        return self._pattern


CODE_FENCE_PAT = re.compile(r"(```[\s\S]*?```|~~~[\s\S]*?~~~)", re.MULTILINE)
INLINE_CODE_PAT = re.compile(r"`[^`]*`")
# A raw HTML tag (`<a id="b04-r6"></a>`): its attributes are not prose.
HTML_TAG_PAT = re.compile(r"</?[A-Za-z][^>\n]*>")
TABLE_RULE_PAT = re.compile(r"^\s*\|?\s*:?-{3,}")
# A Markdown link's destination, which the reader does not see.
LINK_TARGET_PAT = re.compile(r"\]\([^)]*\)")
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


def resolve_pages(texts: dict[str, str], index: XrefIndex) -> dict[str, str]:
    """Resolve every page's fresh Markdown, keyed by page id; returns the linked text."""

    return {rel_path: resolve_text(text, rel_path, index) for rel_path, text in texts.items()}


def resolve_text(text: str, rel_path: str, index: XrefIndex) -> str:
    """Link every known bare ID in one page's rendered Markdown.

    An ID already inside a Markdown link is left alone, so this must run over
    a renderer's fresh output: run over a page it has already resolved, it
    keeps whatever target the ID had then. Run over its own output it changes
    nothing: a mention already linked still counts toward the page's first
    mention, and a line that holds the subsystem's name is never given it again.
    """

    pattern = index.pattern()
    if pattern is None:
        return text

    # Protect fenced and inline code, and raw HTML tags, by replacing them
    # with placeholders.
    placeholders: list[str] = []

    def _stash(m: re.Match) -> str:
        placeholders.append(m.group(0))
        return f"\x00{len(placeholders) - 1}\x00"

    # Generated copy first: a hint may hold a code span of its own.
    if index.protected:
        text = re.compile(identifier_alternation(index.protected)).sub(_stash, text)
    text = CODE_FENCE_PAT.sub(_stash, text)
    text = INLINE_CODE_PAT.sub(_stash, text)
    text = HTML_TAG_PAT.sub(_stash, text)

    named: set[str] = set()
    lines = text.split("\n")
    for at, line in enumerate(lines):
        # A table's header row names columns, and the HTML recognises some
        # tables by those names (the review-coverage matrix), so it gains no
        # name and no prefix. A heading gains no name (it names its own
        # subject), but a concern code in it is still introduced as one.
        header_row = (
            line.lstrip().startswith("|")
            and at + 1 < len(lines)
            and bool(TABLE_RULE_PAT.match(lines[at + 1]))
        )
        heading = line.lstrip().startswith("#")
        lines[at] = _resolve_line(
            line, rel_path, index, pattern, named, plain=header_row or heading, header_row=header_row
        )
    text = "\n".join(lines)

    # Restore placeholders.
    # Existing Markdown links can contain protected inline-code placeholders.
    # Restore outer placeholders first so their nested sentinels are present
    # when the earlier inline-code placeholders are restored.
    for i in reversed(range(len(placeholders))):
        saved = placeholders[i]
        text = text.replace(f"\x00{i}\x00", saved)
    return text


def _resolve_line(
    line: str,
    rel_path: str,
    index: XrefIndex,
    pattern: re.Pattern[str],
    named: set[str],
    *,
    plain: bool,
    header_row: bool = False,
) -> str:
    def _name_after(id_: str, start: int, end: int, label: str = "") -> str:
        """` (Name)` for a page's first mention of a subsystem, else nothing.

        The mention counts as named, and gains nothing, when the reader already
        sees the name: in a table row that holds it (an adjacent Name column),
        in a heading, in the link's own label, or beside the ID in prose
        ("R-06 — Rule evaluation", "Rule evaluation (R-06)", a name an earlier
        run printed). The name elsewhere in a sentence is not beside the ID. A
        link's destination is not shown, so a name in a page path never counts.
        """

        name = index.names.get(id_)
        if name is None or id_ in named:
            return ""
        shown = name.replace("|", "/")
        whole_line = shown in LINK_TARGET_PAT.sub("]", line)
        if plain or line.lstrip().startswith("|"):
            if whole_line:
                named.add(id_)
            return "" if plain or whole_line else _print(id_, shown)
        if shown in label:
            named.add(id_)
            return ""
        after = LINK_TARGET_PAT.sub("]", line[end:])
        before = LINK_TARGET_PAT.sub("]", line[:start])
        if re.match(r"[\s*_)\]:,(\u2014\u2013-]*" + re.escape(shown), after) or re.search(
            re.escape(shown) + r"[\s*_\[(:,\u2014\u2013-]*$", before
        ):
            named.add(id_)
            return ""
        return _print(id_, shown)

    def _print(id_: str, shown: str) -> str:
        named.add(id_)
        return f" ({shown})"

    def _concern_label(id_: str, at: int) -> bool:
        """Whether a concern code printed here owes the "concern" prefix.

        A table's header row (the review-coverage matrix names its columns by
        concern code) is left alone, as is a code the words before it already
        introduce. A heading and the code's own page are not exempt. A link's destination and anchor are not
        touched; only the text the reader sees gains the word.
        """

        return (
            not header_row
            and index.kinds.get(id_) == "concern"
            and not CONCERN_WORD_PAT.search(line[:at])
        )

    def _replace(m: re.Match) -> str:
        if m.group("link"):
            # A link the renderer (or an earlier run) wrote. Its target is left
            # alone; a subsystem ID as the whole label is still a mention, and a
            # concern code as the whole label is introduced as one.
            link = m.group("link")
            label = m.group("label").strip("*")
            if _concern_label(label, m.start()):
                link = "[concern " + link[1:]
            if label in index.names:
                suffix = _name_after(label, m.start(), m.end())
            else:
                # A subsystem ID inside the visible label ("the auth subsystem")
                # is a mention too; its name goes after the link.
                inner = identifier_pattern(index.names)
                hit = inner.search(label) if inner else None
                suffix = _name_after(hit.group(1), m.start(), m.end(), label) if hit else ""
            return link + (m.group("lpost") or "") + suffix
        id_ = m.group("id")
        pre, post = m.group("pre") or "", m.group("post") or ""
        linked = index.link(id_, rel_path)
        if linked is None:
            return m.group(0)
        self_ref = linked == f"**{id_}**"
        concern = _concern_label(id_, m.start())
        if self_ref and (pre or post):
            # Self references render as strong text. If the renderer already
            # supplied that emphasis, keep the token itself so repeated passes
            # do not accumulate another pair of ``**`` delimiters.
            linked = f"concern {id_}" if concern else id_
        elif self_ref and concern:
            linked = f"**concern {id_}**"
        elif concern:
            linked = linked.replace(f"[{id_}]", f"[concern {id_}]", 1)
        return pre + linked + post + _name_after(id_, m.start(), m.end())

    return pattern.sub(_replace, line)


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


@dataclass
class _Walk:
    """One page's resolution: the index, the page's path and the IDs already named."""

    rel_path: str
    index: XrefIndex
    named: set[str] = field(default_factory=set)

    def line(
        self, cells: list[Inlines], *, plain: bool = False, header_row: bool = False, table: bool = False
    ) -> list[Inlines]:
        """Resolve the cells of one line. A table row is one line; its cells share what it names."""

        index = self.index
        pattern = index.pattern()
        if pattern is None:
            return cells
        ids = identifier_pattern(index.entries)
        inner = identifier_pattern(index.names)
        protected = re.compile(identifier_alternation(index.protected)) if index.protected else None
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
                and index.kinds.get(id_) == "concern"
                and not CONCERN_WORD_PAT.search(text[:start])
            )

        def in_text(value: str, base: int, strong: bool) -> tuple[list[Inline], str]:
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
                    parts.append(Text(label) if strong else Strong((Text(label),)))
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
            nodes: tuple[Inline, ...], base: int, strong: bool
        ) -> tuple[list[Inline], str]:
            out: list[Inline] = []
            owed = ""
            for number, node in enumerate(nodes):
                width = len(_flat((node,)))
                last = number == len(nodes) - 1
                here = ""
                if isinstance(node, Text):
                    parts, here = in_text(node.text, base, strong)
                    out.extend(parts)
                elif isinstance(node, Link):
                    label = node.label.strip("*")
                    if concern_label(label, base):
                        node = replace(node, label="concern " + node.label)
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
                    children, inside = nodes_of(node.children, base, strong or isinstance(node, Strong))
                    if inside and isinstance(node, Strong) and children and children[-1] == Text(inside):
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
            out.append(ListItem(text, children))
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
        if isinstance(block, Details):
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
                resolved = iter(self.line(cells, table=True))
                key = next(resolved)
                lede = next(resolved) if record.lede is not None else None
                facts = tuple(replace(fact, value=next(resolved)) for fact in record.facts)
                content = tuple(replace(field_, value=next(resolved)) for field_ in record.fields)
                records.append(replace(record, key=key, lede=lede, facts=facts, fields=content))
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
        if isinstance(block, BoundaryDiagram):
            # The rows name their subsystems in full, so the page counts both ends as named.
            for boundary in block.rows:
                for id_ in (boundary.subsystem_id, boundary.other_id):
                    if id_ in self.index.names:
                        self.named.add(id_)
            return block
        return block


def resolve_model(page: Page, rel_path: str, index: XrefIndex) -> Page:
    """Link every known ID in one page's model, as `resolve_text` does the page's Markdown.

    `rel_path` is the page's plan path, which the index's targets are relative
    to. Run over a renderer's fresh model, never over a model already resolved.
    """

    return replace(page, blocks=_Walk(rel_path, index).blocks(page.blocks))
