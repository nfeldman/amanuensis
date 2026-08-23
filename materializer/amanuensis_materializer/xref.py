"""Cross-reference resolution.

Builds a global ID → relative-path map once per materialization, then
passes over every rendered markdown file and replaces bare IDs with
working links. Respects fenced code blocks (leaves IDs inside them
alone).
"""
from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path


@dataclass
class XrefIndex:
    # id → (display, abs_target_path, human definition)
    entries: dict[str, tuple[str, str, str]]

    def link(self, id_: str, from_page_rel: str) -> str | None:
        hit = self.entries.get(id_)
        if not hit:
            return None
        display, target, _definition = hit
        # Never self-link: an ID whose canonical page IS the current
        # page should render as bold text, not a link-to-self.
        # We also suppress anchor-only self-links (target starts with
        # the same relative path and differs only by #fragment).
        target_no_frag = target.split("#", 1)[0]
        if target == from_page_rel or target_no_frag == from_page_rel:
            return f"**{display}**"
        rel = _relative(from_page_rel, target)
        return f"[{display}]({rel})"


CODE_FENCE_PAT = re.compile(r"(```[\s\S]*?```|~~~[\s\S]*?~~~)", re.MULTILINE)
INLINE_CODE_PAT = re.compile(r"`[^`]*`")
# Any uppercase letters + optional digits + dash + digits, captured as
# a single token. This intentionally overmatches — we let the index
# decide whether the ID is known.
ID_PAT = re.compile(r"(?<![\w-])([A-Z]{1,3}\d{0,3}-\d{1,3})(?![\w-])")


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
    text = abs_path.read_text()
    original = text

    # Protect fenced and inline code by replacing with placeholders.
    placeholders: list[str] = []

    def _stash(m: re.Match) -> str:
        placeholders.append(m.group(0))
        return f"\x00{len(placeholders) - 1}\x00"

    text = CODE_FENCE_PAT.sub(_stash, text)
    text = INLINE_CODE_PAT.sub(_stash, text)

    # Also protect existing markdown links: avoid rewriting IDs that are
    # already inside (…).
    def _skip_in_links(match: re.Match) -> str:
        # Will be restored later.
        placeholders.append(match.group(0))
        return f"\x00{len(placeholders) - 1}\x00"

    text = re.sub(r"\[[^\]]*\]\([^)]*\)", _skip_in_links, text)

    def _replace(m: re.Match) -> str:
        id_ = m.group(1)
        linked = index.link(id_, rel_path)
        # Self references render as strong text. If the renderer already
        # supplied that emphasis, keep the token itself so repeated passes do
        # not accumulate another pair of ``**`` delimiters.
        if linked == f"**{id_}**":
            before = text[max(0, m.start() - 2) : m.start()]
            after = text[m.end() : m.end() + 2]
            if before == "**" and after == "**":
                return id_
        return linked if linked else m.group(0)

    text = ID_PAT.sub(_replace, text)

    # Restore placeholders.
    # Existing Markdown links can contain protected inline-code placeholders.
    # Restore outer placeholders first so their nested sentinels are present
    # when the earlier inline-code placeholders are restored.
    for i in reversed(range(len(placeholders))):
        saved = placeholders[i]
        text = text.replace(f"\x00{i}\x00", saved)

    if text != original:
        abs_path.write_text(text)
        return True
    return False


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
