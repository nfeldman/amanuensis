"""The stored-prose grammar and the inline subset every page text goes through.

Store-only PLAN §3.4. A body stored by `record_explanation`, `record_narrative`
and the other prose fields is text in a documented subset: paragraphs; `-`, `*`
and numbered lists; code spans and fenced code; `*`/`_` emphasis; `**` strong;
links. This module renders that subset into the page model's inlines and
blocks (`render_prose`), and holds the inline reader (`parse_inlines`) the page
builders also run record-authored text through, so a value with a code span or a
link prints as it always did. It reads no headings, tables or raw HTML as
structure. Imported bodies, which are full Markdown, are `legacy_prose.py`'s.

A link to `<page>.md` in older prose is rewritten to `.html` (`_html_href`).
"""

from __future__ import annotations

import html
import re
from urllib.parse import urlsplit, urlunsplit

from .page import (
    Abbr,
    Block,
    Break,
    Chip,
    Code,
    CodeSpan,
    Emph,
    Heading,
    Inline,
    InlineAnchor,
    InlineMarker,
    Inlines,
    Link,
    List,
    ListItem,
    Paragraph,
    Quote,
    Strong,
    Tag,
    Text,
)
from .readback import MARKER_KINDS
from .vocabulary import axes, labels, meanings

_MARKER_RE = re.compile(
    r"<!--\s*amanuensis:(?:"
    + "|".join(MARKER_KINDS)
    + r"):[0-9a-f]+\s*-->"
)

# The reader-facing vocabulary is not restated here. Every hint, label, and
# axis below is built from contracts/conspectus-vocabulary.json through the
# generated `vocabulary` module, so a value the server accepts and a value the
# projection can explain are the same set by construction.
#
# These tables are one flat namespace over several axes — `_status_html` and
# `_code_html` look a bare token up without knowing which enum it came from —
# so a value carried by more than one enum is taken from the first enum in the
# precedence below. The order is declared, never dictionary chance.
_STATUS_ENUMS = (
    "subsystem_status",
    "disposition_classification",
    "finding_status",
    "finding_resolution_state",
    "diagnosticity_outcome",
)

STATUS_HINTS = meanings(*_STATUS_ENUMS)

EVIDENCE_HINTS = meanings("evidence_kind")

SEVERITY_HINTS = meanings("severity")

DISPLAY_STATUS = labels(*_STATUS_ENUMS, "evidence_kind")

STATUS_AXIS = axes(*_STATUS_ENUMS)


def _plain(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", text)
    text = text.replace("**", "").replace("__", "").replace("`", "")
    return html.unescape(text).strip()


def _html_href(href: str) -> str:
    if href.startswith(("http://", "https://", "mailto:", "#")):
        return href
    split = urlsplit(href)
    if split.scheme or split.netloc:
        return "#"
    path = split.path
    if path.endswith(".md"):
        path = path[:-3] + ".html"
    return urlunsplit(("", "", path, split.query, split.fragment))


def _code_inline(value: str) -> Inline:
    """A code span: a stored status or evidence value prints as its chip."""

    key = value.strip().lower()
    if key in STATUS_HINTS:
        return Chip("status", key)
    if key in EVIDENCE_HINTS:
        return Chip("evidence", key)
    if value == "ACH":
        return Abbr("ACH", "Analysis of Competing Hypotheses")
    return CodeSpan(value)


def _names_label(text: str) -> bool:
    """Whether a bare cell is a stored value or its own label, not another enum's word.

    A label such as pass_type's "Adversarial" lowercases to a status value whose
    label differs; chipping it would print that other label in its place.
    """

    key = text.lower()
    return text == key or text == DISPLAY_STATUS.get(key, key.replace("-", " ").title())


# Emphasis, in the order it was always applied. Each pair is marked with two
# private characters rather than tags, so that a pair the text leaves
# misnested can still be told apart from a nested one.
_STRONG_OPEN, _STRONG_CLOSE, _EM_OPEN, _EM_CLOSE = "\x01", "\x02", "\x03", "\x04"
_EMPHASIS = (
    (re.compile(r"\*\*(.+?)\*\*"), _STRONG_OPEN, _STRONG_CLOSE),
    (re.compile(r"__(.+?)__"), _STRONG_OPEN, _STRONG_CLOSE),
    (re.compile(r"(?<!\w)_(.+?)_(?!\w)"), _EM_OPEN, _EM_CLOSE),
    (re.compile(r"(?<!\*)\*([^*]+)\*(?!\*)"), _EM_OPEN, _EM_CLOSE),
)
_INLINE_TOKEN = re.compile(r"(\x00\d+\x00|[\x01-\x04])")
_DISPLAY_PHRASES = {
    "concern dispositions": "concern review",
    "evidence dispositions": "concern review",
    "jump-in reading": "start here",
}


def _text_nodes(text: str) -> list[Inline]:
    nodes: list[Inline] = []
    for index, part in enumerate(text.split("  \n")):
        if index:
            nodes.append(Break())
        if part:
            nodes.append(Text(part))
    return nodes


def _inline_tree(tokens: list[str], stash: list[Inline]) -> tuple[Inline, ...] | None:
    """Nest the emphasis marks; None when a pair crosses another."""

    stack: list[tuple[str, list[Inline]]] = [("", [])]
    for token in tokens:
        if token in (_STRONG_OPEN, _EM_OPEN):
            stack.append((token, []))
        elif token in (_STRONG_CLOSE, _EM_CLOSE):
            opener = _STRONG_OPEN if token == _STRONG_CLOSE else _EM_OPEN
            if stack[-1][0] != opener:
                return None
            kind, children = stack.pop()
            stack[-1][1].append(Strong(tuple(children)) if kind == _STRONG_OPEN else Emph(tuple(children)))
        elif token.startswith("\x00"):
            stack[-1][1].append(stash[int(token[1:-1])])
        else:
            stack[-1][1].extend(_text_nodes(token))
    return tuple(stack[0][1]) if len(stack) == 1 else None


def _inline_flat(tokens: list[str], stash: list[Inline]) -> tuple[Inline, ...]:
    marks = {
        _STRONG_OPEN: Tag("strong", False),
        _STRONG_CLOSE: Tag("strong", True),
        _EM_OPEN: Tag("em", False),
        _EM_CLOSE: Tag("em", True),
    }
    nodes: list[Inline] = []
    for token in tokens:
        if token in marks:
            nodes.append(marks[token])
        elif token.startswith("\x00"):
            nodes.append(stash[int(token[1:-1])])
        else:
            nodes.extend(_text_nodes(token))
    return tuple(nodes)


def parse_inlines(text: str) -> Inlines:
    """Resolve the deliberately small inline subset emitted by Amanuensis."""

    plain = _plain(text)
    stripped = text.strip()
    if stripped.lower() in STATUS_HINTS and _names_label(stripped):
        return Inlines((Chip("status", stripped),), plain)
    if stripped.lower() in EVIDENCE_HINTS and _names_label(stripped):
        return Inlines((_code_inline(stripped),), plain)
    if stripped.upper() in SEVERITY_HINTS:
        return Inlines((Chip("severity", stripped),), plain)

    stash: list[Inline] = []

    def keep(node: Inline) -> str:
        stash.append(node)
        return f"\x00{len(stash) - 1}\x00"

    # Durable projection markers and explicit xref anchors are the only raw
    # HTML accepted.  All record-authored prose is escaped by the writer.
    text = re.sub(_MARKER_RE, lambda m: keep(InlineMarker(m.group(0))), text)
    text = re.sub(
        r'<a\s+id="([a-zA-Z0-9_.:-]+)"></a>',
        lambda m: keep(InlineAnchor(m.group(1))),
        text,
    )
    text = re.sub(r"`([^`]+)`", lambda m: keep(_code_inline(m.group(1))), text)

    def link(match: re.Match[str]) -> str:
        href = _html_href(match.group(2).strip())
        return keep(Link(href, _plain(match.group(1)), href.startswith(("http://", "https://"))))

    text = re.sub(r"\[([^]]+)\]\(([^)]+)\)", link, text)
    text = re.sub(
        r"([🟢🟡🟠🔵⚪⚫])\s+(mapped|adversarial|concerns|structural|scoping|unmapped|deferred)",
        lambda m: keep(Chip("status", m.group(2))),
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"([🔴🟠🟡🔵])\s+(CRITICAL|HIGH|MEDIUM|LOW)",
        lambda m: keep(Chip("severity", m.group(2))),
        text,
    )

    # Retained survey prose may use durable schema vocabulary. Translate it at
    # the human projection boundary without rewriting the Markdown record.
    for source, replacement in _DISPLAY_PHRASES.items():
        text = re.sub(
            re.escape(source),
            lambda match, value=replacement: value.capitalize()
            if match.group(0)[0].isupper()
            else value,
            text,
            flags=re.IGNORECASE,
        )

    for pattern, opener, closer in _EMPHASIS:
        text = pattern.sub(lambda m, o=opener, c=closer: f"{o}{m.group(1)}{c}", text)
    tokens = [token for token in _INLINE_TOKEN.split(text) if token]
    nodes = _inline_tree(tokens, stash)
    return Inlines(nodes if nodes is not None else _inline_flat(tokens, stash), plain)


_LIST_ITEM = re.compile(r"^(\s*)([-*+] |\d+\. )(.*)$")


def _parse_list(lines: list[str], start: int, nested: bool = False) -> tuple[List, int]:
    """Parse the list whose first item is `lines[start]`; return it and the next line.

    An item indented deeper than the list's first item is a child list of the
    preceding item, one level at a time, so a claim's statement is its own item
    and its coordinates a list inside it.  At the top level an item indented
    less than the first is still a sibling, as it always was; a nested list ends
    at the first item shallower than its own.
    """

    first = _LIST_ITEM.match(lines[start])
    assert first is not None
    base = len(first.group(1))
    ordered = first.group(2)[0].isdigit()
    items: list[ListItem] = []
    i = start
    while i < len(lines):
        item = _LIST_ITEM.match(lines[i])
        if not item:
            break
        indent = len(item.group(1))
        if nested and indent < base:
            break
        if indent > base and items:
            child, i = _parse_list(lines, i, nested=True)
            items[-1] = ListItem(items[-1].text, (*items[-1].children, child))
            continue
        if item.group(2)[0].isdigit() != ordered:
            break
        value = item.group(3)
        i += 1
        continuation: list[str] = []
        while i < len(lines) and lines[i].startswith(("  ", "    ")) and not _LIST_ITEM.match(lines[i]):
            continuation.append(lines[i].strip())
            i += 1
        if continuation:
            value += " " + " ".join(continuation)
        items.append(ListItem(parse_inlines(value)))
    return List(ordered, tuple(items)), i


def inlines(text: str) -> Inlines:
    """A record's text, or a sentence the page's own code supplies, as the model's inlines."""

    return parse_inlines(text)


_HEADING_LINE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


def render_prose(text: str, *, under: int | None = None) -> tuple[Block, ...]:
    """A stored body in the §3.4 grammar as blocks: paragraphs, lists, fences, quotes.

    Headings, tables, raw HTML and images are not part of the grammar. A line
    that holds one is a line of its paragraph, printed as text; the writers
    refuse such lines before a body is stored (`isProseAndLists`).

    A row stored before the writers refused headings may still hold one. A page
    that prints such a body passes `under`, the level of the section it sits in:
    each heading line then prints as a heading that many levels deeper (at most
    six), so a body can never open a section of its own.
    """

    lines = text.splitlines()
    blocks: list[Block] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        fence = re.match(r"^```\s*([\w-]*)\s*$", line)
        if fence:
            code_lines: list[str] = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1 if i < len(lines) else 0
            blocks.append(Code(fence.group(1).lower(), "\n".join(code_lines)))
            continue
        heading = _HEADING_LINE.match(line) if under is not None else None
        if heading:
            level = min(6, len(heading.group(1)) + (under or 0))
            blocks.append(Heading(level, parse_inlines(heading.group(2))))
            i += 1
            continue
        if _LIST_ITEM.match(line):
            parsed, i = _parse_list(lines, i)
            blocks.append(parsed)
            continue
        if line.startswith(">"):
            quoted: list[str] = []
            while i < len(lines) and lines[i].startswith(">"):
                quoted.append(lines[i][1:].lstrip())
                i += 1
            blocks.append(Quote(parse_inlines(" ".join(quoted))))
            continue
        paragraph = [line.strip()]
        i += 1
        while i < len(lines) and lines[i].strip():
            candidate = lines[i]
            if candidate.startswith(("```", ">")) or re.match(r"^\s*([-*+] |\d+\. )", candidate):
                break
            if under is not None and _HEADING_LINE.match(candidate):
                break
            paragraph.append(candidate.strip())
            i += 1
        blocks.append(Paragraph(parse_inlines(" ".join(paragraph))))
    return tuple(blocks)
