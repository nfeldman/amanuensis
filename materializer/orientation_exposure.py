"""Shared check for the orientation gates: the report stays exposed to assistive technology.

The gates read a page's text, links, counts and SVG from its bytes. An attribute
that removes the report from the accessibility tree (`aria-hidden="true"` on the
shared `<main>`, say) leaves every one of those reads satisfied, so each gate
also asks this module whether the page head, the article, the page foot and
every element around them are exposed.

Hidden means: `aria-hidden="true"`, the `hidden` or `inert` attribute, an inline
`display: none` or `visibility: hidden`, or `role="presentation"`/`role="none"`.
Elements inside the article may hide themselves (a decorative glyph, a closed
`<details>`); only the report's containers and their ancestors are checked.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path

_VOID = frozenset({
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
})


def _hides(tag: str, attrs: list[tuple[str, str | None]]) -> str | None:
    del tag
    for name, value in attrs:
        name = name.lower()
        text = (value or "").strip().lower()
        if name == "aria-hidden" and text == "true":
            return 'aria-hidden="true"'
        if name in ("hidden", "inert"):
            return name
        if name == "style" and re.search(r"display\s*:\s*none|visibility\s*:\s*hidden", text):
            return f'style="{value}"'
        if name == "role" and text in ("presentation", "none"):
            return f'role="{text}"'
    return None


def _is_report(tag: str, attrs: list[tuple[str, str | None]]) -> bool:
    classes = (dict(attrs).get("class") or "").split()
    return (
        tag == "main"
        or tag == "article"
        or (tag == "header" and "page-head" in classes)
        # The page foot carries the revision, freshness and render notice (codex, 2026-11-26).
        or (tag == "footer" and "page-foot" in classes)
    )


class _Exposure(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, str | None]] = []
        self.reports = 0
        self.problem: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        hidden = _hides(tag, attrs)
        if _is_report(tag, attrs) and self.problem is None:
            self.reports += 1
            if hidden:
                self.problem = f"<{tag}> carries {hidden}"
            else:
                for outer, outer_hidden in self.stack:
                    if outer_hidden:
                        self.problem = f"<{tag}> sits inside <{outer}>, which carries {outer_hidden}"
                        break
        if tag not in _VOID:
            self.stack.append((tag, hidden))

    def handle_endtag(self, tag: str) -> None:
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break


def hidden_report(page: str) -> str | None:
    """Why this HTML page hides its report from assistive technology, or None."""

    parser = _Exposure()
    parser.feed(page)
    parser.close()
    if parser.problem:
        return parser.problem
    if parser.reports == 0:
        return "no <main>, page head or <article> to check"
    return None


def hidden_pages(*directories: Path) -> str | None:
    """The first published HTML page, across these directories, that hides its report."""

    seen = 0
    for directory in directories:
        for path in sorted(directory.rglob("*.html")):
            seen += 1
            problem = hidden_report(path.read_text(encoding="utf-8"))
            if problem:
                return f"{path.relative_to(directory).as_posix()}: {problem}"
    return None if seen else "no published HTML page to check"
