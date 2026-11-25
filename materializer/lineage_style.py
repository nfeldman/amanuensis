"""What the lineage gates compare once the style lane has changed the page.

The store-only lineage gates (SO13-SO18) compare a page the current tree prints
with the page the tree their packet started from prints for the same store, so a
conversion that changed one byte is red. The style lane changed the page on
purpose:

  - the stylesheet and script moved out of every page into shared, hashed files
    under `assets/`, and the page head was rearranged (an "About this page"
    popover holds "Use it when" and the page's terms; the vitals strip names
    a subsystem's survey depth);
  - inline `style` attributes on diagrams and badges became classes (`tone-*`);
  - a subsystem page no longer opens with its Status and Layer lines, and its
    "Start here" section became a line in Scope, ahead of its survey note;
  - a path the ledger knows is wrapped in a source mark carrying
    `data-source-path` and `data-source-rev`, and a link to the host when the
    origin has a known branch that holds the path (a file record used to link
    the commit it was read at; that link is taken off the start side).

So the lineage gates compare article bodies, with those changes carried to the
start side and the marks taken off the current side. Everything outside the
article (the shell, the stylesheet and the script) is held byte for byte by the
golden corpus and by test-materializer.py instead. A lineage file under
`assets/` is the style lane's and has no start-side counterpart.
"""

from __future__ import annotations

import re

# The page's own article, to its last closing tag: records inside it are articles too.
_ARTICLE = re.compile(r'<article class="content\b.*</article>', re.S)
_SOURCE_MARK = re.compile(
    r'<(span|a) class="(?:source-path|source-link|file-source-link)"[^>]*\bdata-source-path="[^"]*"[^>]*>(.*?)</\1>',
    re.S,
)
# Before the style lane a file record linked the commit it was read at, with no marks.
_COMMIT_LINK = re.compile(r'<a class="file-source-link" href="[^"]*/blob/[0-9a-f]{7,40}/[^"]*"[^>]*>(.*?)</a>', re.S)
_STYLE_ATTR = re.compile(r' style="[^"]*"')
_TONE_CLASS = re.compile(r" tone-[\w-]+")
_STATUS_LINE = re.compile(r"<p\b[^>]*><strong>Status</strong>:.*?</p>\n?", re.S)
_LAYER_LINE = re.compile(r"<p><strong>Layer</strong>:.*?</p>\n?", re.S)
# Scope's survey note, when there is one, stays last: Start here goes in before it.
_START_HERE = re.compile(
    r'(<h3 id="survey-note">(?:(?!</section>).)*)?</section>\n<section class="section-start-here">\n'
    r'<h2 id="start-here">.*?</h2>\n<p>(.*?)</p>\n</section>',
    re.S,
)


def is_style_asset(relative: str) -> bool:
    """Whether a published path is one of the style lane's shared files."""

    return relative.startswith("assets/")


def _article(text: str) -> str:
    match = _ARTICLE.search(text)
    return match.group(0) if match else text


def _both(text: str) -> str:
    return _TONE_CLASS.sub("", _STYLE_ATTR.sub("", text))


def current(text: str) -> str:
    """The current tree's page, as the lineage gates compare it."""

    if not text.lstrip().startswith("<!doctype html>"):
        return text
    return _both(_SOURCE_MARK.sub(lambda m: m.group(2), _article(text)))


def start(text: str) -> str:
    """The start tree's page, with the style lane's changes carried to it."""

    if not text.lstrip().startswith("<!doctype html>"):
        return text
    body = _COMMIT_LINK.sub(lambda m: m.group(1), _article(text))
    body = _STATUS_LINE.sub("", body, count=1) if 'class="content content-subsystem"' in body else body
    body = _LAYER_LINE.sub("", body, count=1) if 'class="content content-subsystem"' in body else body
    body = _START_HERE.sub(
        lambda m: f'<p class="start-here"><strong>Start here</strong> {m.group(2)}</p>\n{m.group(1) or ""}</section>', body
    )
    return _both(body)


def pair(now: str, then: str) -> tuple[str, str]:
    """A current page and an earlier one, as a lineage gate compares them.

    A page the style lane did not reprint (the kept `hooks` fixture, a lens page
    written against a workspace the corpus lacks) is the same on both sides and
    is compared as it is.
    """

    return (now, then) if now == then else (current(now), start(then))
