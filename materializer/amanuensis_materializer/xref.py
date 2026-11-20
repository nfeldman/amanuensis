"""Cross-reference resolution.

Builds a global ID → relative-path map once per materialization, then
passes over every rendered markdown file and replaces bare IDs with
working links. Respects fenced code blocks (leaves IDs inside them
alone).

The match pattern is built from the index's own keys, so any ID the store
holds links, whatever its shape (`B04-R6`, a lowercase `auth`), and nothing
the store does not hold is touched (PLAN §2.2 item 4). The same pass names a
subsystem beside its first mention on a page (item 3) and introduces a concern
code as "concern RC-2" (item 5).
"""
from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class XrefIndex:
    # id → (display, abs_target_path, human definition)
    entries: dict[str, tuple[str, str, str]]
    # subsystem id → name, printed beside a page's first mention of the id
    names: dict[str, str] = field(default_factory=dict)
    # id → record kind ("subsystem", "concern", "seam", "finding", "matrix")
    kinds: dict[str, str] = field(default_factory=dict)
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


def resolve_file(abs_path: Path, rel_path: str, index: XrefIndex) -> bool:
    """Rewrite IDs in a file. Returns True if the file changed."""
    original = abs_path.read_text()
    text = resolve_text(original, rel_path, index)
    if text != original:
        abs_path.write_text(text)
        return True
    return False


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


def resolve_all(output_root: Path, rel_paths: Iterable[str], index: XrefIndex) -> int:
    """Apply cross-ref resolution across every rendered page. Returns
    the number of files that changed.

    Every candidate path is resolved and verified to stay within
    `output_root`. All current callers pass slug-derived paths that
    cannot escape, so this is defense in depth — a future refactor
    that feeds DB-derived or user-supplied paths in will not silently
    rewrite files outside the output tree.
    """
    root = output_root.resolve()
    changed = 0
    for rel in rel_paths:
        abs_path = (root / rel).resolve()
        try:
            abs_path.relative_to(root)
        except ValueError:
            continue
        if not abs_path.is_file():
            continue
        if resolve_file(abs_path, rel, index):
            changed += 1
    return changed
