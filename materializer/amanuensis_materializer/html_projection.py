"""Self-contained HTML projection for the human-facing conspectus.

HTML is the only published view (store-only PLAN §3.2).  This module turns each
page's model, built by its renderer and linked by the cross-reference pass, into a
dependency-free HTML site with global navigation, reader hints, semantic
status labels, and local-link integrity.  Every page links the same stylesheet
and script, kept as files in ``site/`` and written beside the pages under names
that carry their content hash, so the projection works from ``file://`` as well
as from a static web server and a cached asset is never the wrong one.

A page is a model of the blocks of `page.py`, and `write_html` prints those blocks.
No Markdown is read here: the one Markdown reader left is `legacy_prose.py`, for
the bodies an earlier version had the survey write by hand.
"""

from __future__ import annotations

import html
import json
import posixpath
import re
import string
import textwrap
from collections.abc import Sequence
from contextvars import ContextVar
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import quote

from .diagrams import draw_svg
from .manifest import sha256_bytes
from .page import (
    COVERAGE_STATES,
    Abbr,
    Anchor,
    Atlas,
    AtlasItem,
    Badge,
    BadgeNote,
    Block,
    BoundaryDiagram,
    Break,
    Chip,
    Code,
    CodeSpan,
    ConcernChecklist,
    CoverageIndex,
    Details,
    Diagram,
    DiagramSource,
    Emph,
    EnumTable,
    Heading,
    Inline,
    InlineAnchor,
    InlineMarker,
    Inlines,
    LifecycleTable,
    Link,
    List,
    Marked,
    Page,
    Paragraph,
    Quote,
    RecordList,
    RecordMarker,
    RelationshipTrace,
    RuntimeDiagram,
    Section,
    StalenessBars,
    Strong,
    SummaryList,
    Table,
    Tag,
    Text,
    Topology,
    TraceNode,
)
from .prose import (
    DISPLAY_STATUS,
    EVIDENCE_HINTS,
    SEVERITY_HINTS,
    STATUS_AXIS,
    STATUS_HINTS,
    parse_inlines,
)
from .slugs import slugify
from .vocabulary import READER_TERMS
from .xref import identifier_pattern

HTML_PROJECTION_VERSION = "1.14.0"

# The navigation groups, in the order a reader meets them (spec §7.1). Four of
# them are the reader lenses of §1.1; `Overview` is the entrance and is not a
# lens. The order is explicit because the previous grouping was dict insertion
# order over the page plan, which made the rail's shape a side effect of the
# order pages happened to be appended in. A page whose `group` is not named
# here is a render error: a lens the reader's guide does not explain, appended
# silently, is exactly the drift this constant removes.
NAV_GROUPS: tuple[str, ...] = ("Overview", "Codebase", "Unresolved", "History", "Method")

# The one generated projection artifact that is neither Markdown nor HTML
# (spec §8.1.1). It assigns a single global and runs nothing, is referenced by
# a relative `<script src>` so it loads from `file://`, and is recorded in
# `manifest.projection_files` and in the publication receipt like any page.
SEARCH_INDEX_PATH = "search-index.js"

# The one `.md` a publication holds (store-only PLAN §6, D10): a README that
# points at `index.html`, because GitHub's directory view shows a README and shows
# `.html` only as source. It is the same bytes for every store: nothing a survey
# recorded is in it, so it is a pointer and not a page. It is a projection file
# like the search index, and the read-back holds it to exactly this text.
README_PATH = "README.md"
README_TEXT = (
    "# Documentation\n"
    "\n"
    "Open [index.html](index.html) to read this documentation.\n"
    "\n"
    "The pages are generated HTML. This file only points at them.\n"
)


class UnknownNavGroup(ValueError):
    """A planned page claims a navigation group `NAV_GROUPS` does not name."""


def assert_nav_groups(groups: Sequence[tuple[str, str]]) -> None:
    """Refuse `(path, group)` pairs that no navigation group would hold.

    Raised before anything is written. The projection cannot render a page it
    has nowhere to route from, and appending a sixth group would publish a
    lens with no definition in `how-to-read.html` (§7.8).
    """

    rogue = sorted({f"{path} (group {group!r})" for path, group in groups if group not in NAV_GROUPS})
    if rogue:
        raise UnknownNavGroup(
            f"{len(rogue)} page(s) claim a navigation group outside NAV_GROUPS "
            f"{NAV_GROUPS}: {', '.join(rogue)}"
        )


@dataclass(frozen=True)
class SitePage:
    """Human-facing identity for one page; `path` is its plan id and its HTML path."""

    path: str
    title: str
    label: str
    hint: str
    group: str
    kind: str = "reference"
    # The clause after "Use it when" (PLAN Appendix D); empty prints nothing.
    use_when: str = ""
    record_id: str | None = None
    status: str | None = None
    # A subsystem's layer, named in the page head beside its id.
    layer: str = ""
    # A named division inside `group`, rendered under its own `<h3>` after the
    # group's ungrouped items (§7.1). Empty means the page sits directly in the
    # group.
    subgroup: str = ""
    # `(term, anchor slug)` for the "Terms on this page" line, from the
    # contract's `reader_terms`; empty prints no line.
    terms: tuple[tuple[str, str], ...] = ()

    @property
    def html_path(self) -> str:
        return self.path


GUIDE_PAGE = "how-to-read.html"
TERMS_LABEL = "Terms on this page:"

# A page `materialize.py` writes for a caller that does not record its read-back
# in the store (PLAN §5 D6, O15). The Publication integrity block on About this
# survey reads the store's last recorded run, so it cannot describe this render;
# each page says so instead, in its footer beside the commit it was read at (a
# reader needs it only when something looks wrong; owner, 2026-11-26). The second
# form is for a render that skipped its read-back.
CLI_RENDER_NOTICE = (
    "Rendered from the command line. Its read-back was not recorded in the survey's"
    " record, so the Publication integrity figures on About this survey describe an"
    " earlier publication."
)
CLI_RENDER_NOTICE_UNVERIFIED = "Rendered from the command line and not read back."
CLI_RENDER_NOTICES = (CLI_RENDER_NOTICE, CLI_RENDER_NOTICE_UNVERIFIED)


def cli_render_notice(*, recorded: bool, verified: bool) -> str:
    """The notice a render's pages carry; empty when the caller records the read-back."""

    if recorded:
        return ""
    return CLI_RENDER_NOTICE if verified else CLI_RENDER_NOTICE_UNVERIFIED


# The snapshot strip's label for a page's status, by page kind, and whether the
# strip carries the page's record mark.
_STRIP_STATUS = {"subsystem": ("Survey depth", True), "matrix": ("Outcome", False)}

_TERM_DEFINITIONS = {str(entry["term"]): str(entry.get("definition") or "") for entry in READER_TERMS}


def _page_help(page: SitePage) -> str:
    """The page's own help: when to use it and the terms it uses, behind one button.

    A reader starting out needs both, and a reader who knows the site needs
    neither, so they sit in a popover the page head opens rather than in the
    head itself. The popover is declarative (`popovertarget`), so it opens
    without the site script; the script only places it beside its button.
    """

    if not page.use_when and not page.terms:
        return ""
    parts: list[str] = []
    if page.use_when:
        parts.append(f'<p class="page-use-when">{html.escape("Use it when " + page.use_when)}</p>')
    if page.terms:
        guide_href = _rel_link(page.html_path, GUIDE_PAGE)
        rows = "".join(
            f'<div><dt><a href="{html.escape(guide_href + "#term-" + slug, quote=True)}">'
            f"{html.escape(term)}</a></dt>"
            + (f"<dd>{html.escape(_TERM_DEFINITIONS[term])}</dd>" if _TERM_DEFINITIONS.get(term) else "")
            + "</div>"
            for term, slug in page.terms
        )
        parts.append(
            f'<p class="help-heading">{html.escape(TERMS_LABEL.rstrip(":"))}</p>'
            f'<dl class="help-terms">{rows}</dl>'
        )
        parts.append(
            f'<p class="help-more"><a href="{html.escape(guide_href, quote=True)}">Reader\'s guide</a></p>'
        )
    return (
        '<button class="quiet-button help-button" type="button" popovertarget="page-help" '
        'aria-haspopup="dialog">About this page</button>'
        '<div class="help-popover" id="page-help" popover role="dialog" aria-label="About this page">'
        + "".join(parts)
        + "</div>"
    )


def terms_line(page_path: str, terms: Sequence[tuple[str, str]]) -> str:
    """The line listing a page's terms, linked to the guide's anchors.

    The HTML head prints the terms itself; this text is the page's recorded
    head, hashed with the model so a changed term list re-renders the page, and
    held out of the cross-reference pass as generated copy.
    """

    if not terms:
        return ""
    base = posixpath.dirname(page_path) or "."
    guide = posixpath.relpath(GUIDE_PAGE, base)
    links = " · ".join(f"[{term}]({guide}#term-{slug})" for term, slug in terms)
    return f"{TERMS_LABEL} {links}"


@dataclass
class HtmlProjectionResult:
    files: dict[str, str]
    rendered: int
    unchanged: int
    retired: list[str]
    warnings: list[str]




# The stylesheet, the page script and the page shell are files in `site/`, edited as CSS, JavaScript
# and HTML. A publication writes the stylesheet and the script once, under names that carry a hash of
# their bytes (`assets/site.<hash>.css`), and every page links them, so a browser caches them and a
# changed file gets a new name.
SITE_DIR = Path(__file__).with_name("site")
_CSS = (SITE_DIR / "site.css").read_text()
_JS = (SITE_DIR / "site.js").read_text()
_PAGE_TEMPLATE = string.Template((SITE_DIR / "page.html").read_text())


def _asset_path(stem: str, suffix: str, text: str) -> str:
    return f"assets/{stem}.{sha256_bytes(text.encode('utf-8'))[:12]}.{suffix}"


SITE_CSS_PATH = _asset_path("site", "css", _CSS)
SITE_JS_PATH = _asset_path("site", "js", _JS)
SITE_ASSETS: dict[str, str] = {SITE_CSS_PATH: _CSS, SITE_JS_PATH: _JS}



# ---------------------------------------------------------------------------
# Page model → HTML. Nothing below reads Markdown: every block already says
# what it is, and every inline already says how it prints.
# ---------------------------------------------------------------------------


def _rel_link(from_path: str, to_path: str) -> str:
    base = posixpath.dirname(from_path) or "."
    return posixpath.relpath(to_path, base)


def _status_html(value: str, *, severity: bool = False, show_hint: bool = True) -> str:
    raw = value.strip()
    key = raw.lower()
    if severity:
        key = raw.upper()
        label = key.title()
        hint = SEVERITY_HINTS.get(key, "Finding impact level.")
        hint_attr = f' title="{html.escape(hint, quote=True)}"' if show_hint else ""
        return f'<span class="severity severity-{key.lower()}"{hint_attr}>{html.escape(label)}</span>'
    hint = STATUS_HINTS.get(key, "Recorded workflow state.")
    label = DISPLAY_STATUS.get(key, key.replace("-", " ").title())
    axis = STATUS_AXIS.get(key, "workflow")
    hint_attr = f' title="{html.escape(hint, quote=True)}"' if show_hint else ""
    return f'<span class="status status-{axis} status-{html.escape(key)}"{hint_attr}>{html.escape(label)}</span>'


def _chip_html(chip: Chip) -> str:
    if chip.enum == "severity":
        return _status_html(chip.value, severity=True, show_hint=chip.show_hint)
    if chip.enum == "evidence":
        key = chip.value
        label = DISPLAY_STATUS.get(key, key.replace("-", " ").title())
        cls = f"evidence-label evidence-{key}"
        return f'<span class="{cls}" title="{html.escape(EVIDENCE_HINTS[key], quote=True)}">{html.escape(label)}</span>'
    return _status_html(chip.value, show_hint=chip.show_hint)


# The hosts whose file pages have a known address. A self-hosted forge cannot
# be told from any other server by its URL, so only these link; a repository
# URL is never guessed (reporting-style, "Architecture and source routes").
# Each entry: the host's name, the repository URL it accepts, and the address
# of one file at one revision.
SOURCE_HOSTS = (
    ("GitHub", re.compile(r"https://github\.com/[^/]+/[^/]+"), "{base}/blob/{rev}/{path}"),
    ("GitLab", re.compile(r"https://gitlab\.com/[^/]+(?:/[^/]+)+"), "{base}/-/blob/{rev}/{path}"),
    ("Bitbucket", re.compile(r"https://bitbucket\.org/[^/]+/[^/]+"), "{base}/src/{rev}/{path}"),
)


def source_file_url(repository_url: str | None, path: str, ref: str | None) -> tuple[str, str] | None:
    """The host's page for `path` on branch `ref`, and the host's name, or None.

    `ref` is a branch the origin is known to have (`core._repository_web_ref`),
    never a commit: a commit link breaks until the commit is pushed.
    """

    parts = PurePosixPath(path).parts
    if (
        not repository_url
        or not ref
        or not re.fullmatch(r"[A-Za-z0-9._][A-Za-z0-9._/-]*", ref)
        or ".." in ref
        or not parts
        or path.startswith("/")
        or ".." in parts
    ):
        return None
    base = repository_url.rstrip("/")
    for name, accepts, address in SOURCE_HOSTS:
        if accepts.fullmatch(base):
            return address.format(base=base, rev=quote(ref, safe="/"), path=quote(path, safe="/")), name
    return None


@dataclass(frozen=True)
class SourceLinks:
    """What a page needs to mark, and link, the repository paths its prose names.

    Only a path the file ledger holds is marked: the ledger is reconciled
    against the checked revision, so each such path is a file the tree has
    there. With no known host the path is still marked, and not linked.
    """

    repository_url: str | None
    # The branch links name, and the checked revision the marks carry.
    ref: str | None
    revision: str
    paths: frozenset[str]
    pattern: re.Pattern[str]
    # The paths the linked branch holds; None when not known (then any marked path links).
    linkable: frozenset[str] | None = None


def source_links(context: dict[str, Any]) -> SourceLinks | None:
    url = str(context.get("repository_url") or "")
    revision = str(context.get("last_checked_sha") or "")
    paths = sorted({str(p) for p in context.get("source_paths") or () if p})
    if not paths:
        return None
    alternation = "|".join(re.escape(p) for p in sorted(paths, key=lambda p: (-len(p), p)))
    # Whole paths only: not part of a longer path, a word or a file name with
    # a further extension. A full stop after a path ends a sentence.
    pattern = re.compile(rf"(?<![\w./-])({alternation})(?![\w/-]|\.\w)")
    ref = str(context.get("repository_ref") or "") or None
    return SourceLinks(url.rstrip("/") or None, ref, revision, frozenset(paths), pattern, linkable_of(context))


def linkable_of(context: dict[str, Any]) -> frozenset[str] | None:
    held = context.get("linkable_paths")
    return None if held is None else frozenset(str(p) for p in held)


# Set while a render prints page bodies; unset, prose prints no source marks
# (the read-back's `_inline` compares words, which marks do not change).
_SOURCE_LINKS: ContextVar[SourceLinks | None] = ContextVar("_SOURCE_LINKS", default=None)


def source_mark(
    path: str,
    revision: str,
    repository_url: str | None,
    ref: str | None,
    inner: str,
    *,
    link_class: str,
    linkable: frozenset[str] | None = None,
) -> str:
    """A repository path as printed: a link to its host, or a plain mark.

    Either way it carries `data-source-path` (repository-relative) and, when
    known, `data-source-rev`, so a tool other than a browser, such as an editor
    showing these pages, can resolve the path itself. The attributes are the
    contract; the link is one use of it.
    """

    parts = PurePosixPath(path).parts
    if not parts or path.startswith("/") or ".." in parts:
        return inner
    attrs = f' data-source-path="{html.escape(path, quote=True)}"'
    if re.fullmatch(r"[0-9a-fA-F]{7,40}", revision):
        attrs += f' data-source-rev="{html.escape(revision, quote=True)}"'
    found = source_file_url(repository_url, path, ref) if linkable is None or path in linkable else None
    if found is None:
        return f'<span class="source-path"{attrs}>{inner}</span>'
    url, host = found
    title = f"Open {path} on {host}, branch {ref}"
    return (
        f'<a class="{link_class}" href="{html.escape(url, quote=True)}" rel="noreferrer" '
        f'title="{html.escape(title, quote=True)}"{attrs}>{inner}</a>'
    )


def _source_anchor(links: SourceLinks, path: str, inner: str) -> str:
    return source_mark(
        path, links.revision, links.repository_url, links.ref, inner, link_class="source-link", linkable=links.linkable
    )


def _text_html(text: str) -> str:
    links = _SOURCE_LINKS.get()
    if links is None or "/" not in text and "." not in text:
        return html.escape(text, quote=False)
    out: list[str] = []
    at = 0
    for match in links.pattern.finditer(text):
        out.append(html.escape(text[at : match.start()], quote=False))
        path = match.group(1)
        out.append(_source_anchor(links, path, html.escape(path, quote=False)))
        at = match.end()
    out.append(html.escape(text[at:], quote=False))
    return "".join(out)


def _inline_html(node: Inline) -> str:
    if isinstance(node, Text):
        return _text_html(node.text)
    if isinstance(node, CodeSpan):
        code = f"<code>{html.escape(node.text)}</code>"
        links = _SOURCE_LINKS.get()
        if links is not None and node.text in links.paths:
            return _source_anchor(links, node.text, code)
        return code
    if isinstance(node, Chip):
        return _chip_html(node)
    if isinstance(node, Strong):
        return f"<strong>{''.join(_inline_html(child) for child in node.children)}</strong>"
    if isinstance(node, Emph):
        return f"<em>{''.join(_inline_html(child) for child in node.children)}</em>"
    if isinstance(node, Link):
        attrs = ' rel="noreferrer"' if node.external else ""
        # A label's own words are escaped as the start tree's link printer
        # escaped them, and nothing inside a link links again.
        held = _SOURCE_LINKS.set(None)
        try:
            label = "".join(
                html.escape(child.text) if isinstance(child, Text) else _inline_html(child)
                for child in node.children or (Text(node.label),)
            )
        finally:
            _SOURCE_LINKS.reset(held)
        return f'<a href="{html.escape(node.href, quote=True)}"{attrs}>{label}</a>'
    if isinstance(node, Abbr):
        return f'<abbr title="{html.escape(node.title, quote=True)}">{html.escape(node.text)}</abbr>'
    if isinstance(node, InlineAnchor):
        return f'<span id="{html.escape(node.id, quote=True)}" class="record-anchor"></span>'
    if isinstance(node, InlineMarker):
        return node.raw
    if isinstance(node, Break):
        return "<br>\n"
    if isinstance(node, Tag):
        return f"<{'/' if node.closing else ''}{node.name}>"
    raise TypeError(f"not an inline node: {node!r}")


def _inlines_html(text: Inlines) -> str:
    return "".join(_inline_html(node) for node in text.nodes)


def _inline(text: str) -> str:
    """Markdown inline text as HTML: `parse_inlines`, then the writer's inline printer.

    Kept for the read-back, which compares a page's words with the store's.
    """

    return _inlines_html(parse_inlines(text))


_DISPLAY_FIELD = {
    "ref sha": "Revision",
    "id": "ID",
    "classification": "Verdict",
    "evidence quality": "Evidence",
    "linchpin?": "Linchpin dependency",
    "why in scope": "Why this file is in scope",
    "codebase-specific probe (abbreviated)": "What to examine",
    "jump-in": "Start here",
    "sev": "Severity",
    "one-line": "Finding",
    "assessable?": "Assessment ready",
    "#": "Number",
}


def _mark_attrs(record: str, state: str = "") -> str:
    """A rendered record's mark (store-only PLAN §3.5): its type and id, and the state it prints."""

    if not record:
        return ""
    attrs = f' data-record="{html.escape(record, quote=True)}"'
    if state:
        attrs += f' data-state="{html.escape(state, quote=True)}"'
    return attrs


def _svg_mark(kind: str, record: str) -> str:
    """A drawn node's or edge's mark: `data-node` or `data-edge`, naming its record (§3.5)."""

    return f' data-{kind}="{html.escape(record, quote=True)}"' if record else ""


#: Colour tokens a badge's measure borrows from the page's severity and resolution ramps.
_BADGE_TONE = {
    "crit-high": "severity-critical",
    "med-low": "severity-medium",
    "awaiting": "resolution-pending",
    "undiscriminated": "disposition-ambiguous",
}


def _badge_attrs(badge: Badge, subsystem: str) -> str:
    review = ' data-under-review="yes"' if badge.review else ""
    return (
        f' data-finding-badge="{html.escape(badge.measure, quote=True)}"'
        f' data-subsystem="{html.escape(subsystem, quote=True)}" data-count="{badge.count}"{review}'
    )


def _atlas_badges(item: AtlasItem) -> str:
    """An atlas item's finding badges, one pill per measure; nothing when it has none (A4)."""

    if not item.badges:
        return ""
    sid = item.record.removeprefix("subsystem:")
    pills = "".join(
        f'<span class="finding-badge tone-{_BADGE_TONE[b.measure]}"{_badge_attrs(b, sid)}>'
        f"{html.escape(b.label)}</span>"
        for b in item.badges
    )
    review = (
        ' <span class="finding-badge-review">under review</span>'
        if any(b.review for b in item.badges)
        else ""
    )
    return (
        '<div class="atlas-badges" role="group" aria-label="Open findings'
        f'{" (under review)" if review else ""}">{pills}{review}</div>'
    )


def _boundary_badges(badges: tuple[Badge, ...], subsystem: str, x: float, y: float, box_w: float) -> str:
    """A boundary box's badges, right-aligned along its top edge, each a rectangle and its short mark (A4)."""

    widths = [10 + 6.6 * len(f"{b.short} {b.count}") for b in badges]
    cursor = x + box_w - sum(widths) - 4 * (len(badges) - 1) - 2
    out: list[str] = []
    for badge, width in zip(badges, widths, strict=True):
        words = badge.label + (" (under review)" if badge.review else "")
        dash = ' stroke-dasharray="3 2"' if badge.review else ""
        out.append(
            f'<g class="boundary-svg-badge"{_badge_attrs(badge, subsystem)}>'
            f"<title>{html.escape(words)}</title>"
            f'<rect x="{round(cursor, 1):g}" y="{round(y - 9, 1):g}" width="{round(width, 1):g}" height="16" rx="2"'
            f' fill="var(--surface)" stroke="var(--{_BADGE_TONE[badge.measure]})" stroke-width="2"{dash}/>'
            f'<text x="{round(cursor + width / 2, 1):g}" y="{round(y + 3, 1):g}" text-anchor="middle" font-size="11"'
            f' font-family="var(--mono)" fill="var(--text)">{html.escape(badge.short)} {badge.count}</text>'
            "</g>"
        )
        cursor += width + 4
    return "".join(out)


_START_TAG = re.compile(r"^<([a-zA-Z][a-zA-Z0-9]*)")


def _marked(element: str, attrs: str) -> str:
    """An element with a record's mark added to its start tag; a comment is left as it is."""

    return _START_TAG.sub(lambda m: f"<{m.group(1)}{attrs}", element, count=1)


def _compose_prose_runs(elements: list[str]) -> list[str]:
    """Give finite runs of sustained prose an editorial multicolumn surface.

    Source order remains ordinary paragraphs. Only adjacent top-level
    paragraphs with enough text to form a useful reading field are wrapped;
    headings, lists, records, tables, figures, and code always terminate a run.
    """

    composed: list[str] = []
    run: list[str] = []

    def flush() -> None:
        if not run:
            return
        character_count = sum(len(re.sub(r"<[^>]+>", "", paragraph)) for paragraph in run)
        use_columns = (len(run) >= 2 and character_count >= 700) or character_count >= 1300
        if use_columns:
            composed.append('<div class="prose-flow">' + "".join(run) + "</div>")
        else:
            composed.extend(run)
        run.clear()

    for element in elements:
        if element.startswith(("<p>", "<p ")) and element.endswith("</p>"):
            run.append(element)
            continue
        flush()
        composed.append(element)
    flush()
    return composed


class _HtmlWriter:
    """One page model, printed. Holds the slugs already used on the page."""

    def __init__(
        self,
        route_map: dict[str, str],
        current_html_path: str,
        repository_url: str | None = None,
        repository_ref: str | None = None,
        linkable_paths: frozenset[str] | None = None,
    ) -> None:
        self.route_map = route_map
        self.linkable_paths = linkable_paths
        self.current_html_path = current_html_path
        self.repository_url = repository_url.rstrip("/") if repository_url else None
        self.repository_ref = repository_ref or None
        self.used_slugs: dict[str, int] = {}

    def _unique_slug(self, plain_title: str) -> str:
        base = slugify(plain_title)
        count = self.used_slugs.get(base, 0)
        self.used_slugs[base] = count + 1
        return base if count == 0 else f"{base}-{count + 1}"

    def _route(self, record_id: str) -> str | None:
        target = self.route_map.get(record_id)
        if not target:
            return None
        return _rel_link(self.current_html_path, target)

    def _trace_node(self, node: TraceNode) -> str:
        body = (
            f'<strong data-identifier-defined>{html.escape(node.record_id)}</strong>'
            f'<span>{html.escape(node.name or node.record_id)}</span>'
        )
        href = self._route(node.record_id)
        if href:
            return f'<a class="relationship-node" href="{html.escape(href, quote=True)}">{body}</a>'
        return f'<span class="relationship-node">{body}</span>'

    def _relationship_trace(self, block: RelationshipTrace) -> str:
        rendered = []
        for edge in block.edges:
            glyph = "↔" if edge.two_way else "→"
            rendered.append(
                '<div class="relationship">'
                + self._trace_node(edge.left)
                + f'<div class="relationship-edge"><b aria-hidden="true">{glyph}</b>{html.escape(edge.label)}</div>'
                + self._trace_node(edge.right)
                + "</div>"
            )
        return '<figure class="figure"><figcaption class="figure-label">Relationship trace</figcaption><div class="relationship-map">' + "".join(rendered) + "</div></figure>"

    @staticmethod
    def _staleness_bars(block: StalenessBars) -> str:
        ceiling = max(value for _, value in block.values) or 1
        bars = "".join(
            f'<div class="bar-row"><span class="bar-label">{html.escape(label)}</span><span class="bar-track"><span class="bar-fill" style="width:{value / ceiling * 100:.2f}%"></span></span><span class="bar-value">{value:g}</span></div>'
            for label, value in block.values
        )
        return f'<figure class="figure"><figcaption class="figure-label">Staleness distribution</figcaption><div class="bar-chart">{bars}</div></figure>'

    @staticmethod
    def _field_label(key: str, kind: str) -> str:
        if key == "classification" and kind == "file-ledger":
            return "Review"
        return _DISPLAY_FIELD.get(key, key.replace("-", " ").capitalize())

    def _record_list(self, block: RecordList) -> str:
        kind = block.kind
        rendered: list[str] = []
        for record in block.records:
            heading_id = self._unique_slug(record.slug_text)
            if kind == "file-ledger":
                path = record.key_text
                basename = posixpath.basename(path) or path
                primary = source_mark(
                    record.path,
                    record.revision,
                    self.repository_url,
                    self.repository_ref,
                    f"<code>{html.escape(basename)}</code>",
                    link_class="file-source-link",
                    linkable=self.linkable_paths,
                )
            elif kind == "open-question":
                primary = f"Question {html.escape(record.key_text)}"
            elif kind == "subsystem":
                route = self._route(record.subsystem_id)
                label = _inlines_html(record.key)
                primary = (
                    f'<a class="record-primary-link" href="{html.escape(route, quote=True)}">{label}</a>'
                    if route
                    else label
                )
            else:
                primary = _inlines_html(record.key)

            fact_chunks: list[str] = []
            for fact in record.facts:
                value_html = _inlines_html(fact.value)
                if kind == "subsystem" and fact.key == "id":
                    value_html = f'<span data-identifier-defined>{value_html}</span>'
                fact_chunks.append(
                    f'<div class="record-fact record-fact-{html.escape(slugify(fact.key), quote=True)}">'
                    f'<dt>{html.escape(self._field_label(fact.key, kind))}</dt><dd>{value_html}</dd></div>'
                )
            facts_html = "".join(fact_chunks)
            heading_tag = "h4" if kind == "finding" else "h3"
            definition_context = " data-identifier-defined" if kind == "finding" else ""
            meta = (
                f'<header class="record-meta"{definition_context}>'
                f'<{heading_tag} class="record-primary" id="{html.escape(heading_id, quote=True)}">{primary}</{heading_tag}>'
                + (f'<dl class="record-facts">{facts_html}</dl>' if facts_html else "")
                + "</header>"
            )
            fields = "".join(
                f'<div class="record-field"><p class="record-label">{html.escape(self._field_label(field.key, kind))}</p>'
                f'<div class="record-copy">{_inlines_html(field.value)}</div></div>'
                for field in record.fields
            )
            if record.lede is not None:
                lede = f'<p class="record-lede">{_inlines_html(record.lede)}</p>'
                content = f'<div class="record-body">{lede}<div class="record-fields">{fields}</div></div>'
            else:
                content = f'<div class="record-fields">{fields}</div>'

            aria = html.escape(f"{kind.replace('-', ' ')} {record.key_text}", quote=True)
            filter_attrs = ""
            if record.filter is not None:
                filter_attrs = (
                    " data-filter-row"
                    f' data-filter-subsystem="{html.escape(record.filter.subsystem, quote=True)}"'
                    f' data-filter-severity="{html.escape(record.filter.severity, quote=True)}"'
                )
            rendered.append(
                "".join(record.markers)
                + f'<article class="record record-{kind}"{filter_attrs} role="listitem" aria-labelledby="{html.escape(heading_id, quote=True)}" data-record-label="{aria}"{_mark_attrs(record.record, record.state)}>'
                + meta
                + content
                + "</article>"
            )

        label = html.escape(block.caption, quote=True)
        return f'<div class="record-list record-list-{kind}" role="list" aria-label="{label}">{"".join(rendered)}</div>'

    def _concern_checklist(self, block: ConcernChecklist) -> str:
        """The calibrated concern table as a grouped reading register."""

        rendered_groups: list[str] = []
        for family in block.families:
            family_name, territory = family.name, family.territory
            family_id = self._unique_slug(family.slug_text)
            family_label = f"{family_name} · {territory}" if territory else family_name
            articles: list[str] = []
            for item in family.items:
                record_id = self._unique_slug(item.slug_text)
                facts = ""
                if item.primary_subsystems.plain:
                    facts = (
                        '<dl class="record-facts"><div class="record-fact record-fact-primary-subsystems">'
                        '<dt>Review in</dt>'
                        f'<dd>{_inlines_html(item.primary_subsystems)}</dd></div></dl>'
                    )
                articles.append(
                    "".join(item.markers)
                    + f'<article class="record record-concern-checklist" role="listitem" '
                    f'aria-labelledby="{html.escape(record_id, quote=True)}" '
                    f'data-record-label="{html.escape(f"concern {item.code_text}", quote=True)}">'
                    '<header class="record-meta">'
                    f'<h4 class="record-primary" id="{html.escape(record_id, quote=True)}">'
                    f'<span data-identifier-defined>{_inlines_html(item.code)}</span></h4>{facts}</header>'
                    f'<div class="record-body"><div class="record-probe">{_inlines_html(item.probe)}</div></div>'
                    '</article>'
                )

            rendered_groups.append(
                f'<div class="concern-family" role="group" aria-labelledby="{html.escape(family_id, quote=True)}">'
                f'<h3 class="concern-family-heading" id="{html.escape(family_id, quote=True)}" data-identifier-defined>'
                f'<a class="heading-anchor" href="#{html.escape(family_id, quote=True)}" '
                f'aria-label="{html.escape(f"Link to {family_label}", quote=True)}">§</a>'
                f'<span>{html.escape(family_name)}</span>'
                + (f'<span class="concern-territory">{html.escape(territory)}</span>' if territory else "")
                + '</h3>'
                f'<div class="record-list record-list-concern-checklist" role="list" '
                f'aria-label="{html.escape(family_label, quote=True)}">{"".join(articles)}</div>'
                '</div>'
            )

        return (
            f'<div class="concern-checklist" aria-label="{html.escape(block.caption, quote=True)}">'
            + "".join(rendered_groups)
            + '</div>'
        )

    @staticmethod
    def _summary_list(block: SummaryList) -> str:
        items = [
            "".join(item.markers)
            + f'<div><dt>{_inlines_html(item.key)}</dt><dd>{_inlines_html(item.value)}</dd></div>'
            for item in block.items
        ]
        return (
            f'<dl class="summary-list" aria-label="{html.escape(block.caption, quote=True)}">'
            + "".join(items)
            + "</dl>"
        )

    @staticmethod
    def _subsystem_atlas(block: Atlas) -> str:
        region_html: list[str] = []
        for region in block.regions:
            items = "".join(
                "".join(item.markers)
                + f'<li class="atlas-item"{_mark_attrs(item.record, item.state)}>'
                + f'<div class="atlas-subsystem" data-identifier-defined>{_inlines_html(item.subsystem)}</div>'
                + f'<div class="atlas-depth">{_inlines_html(item.depth)}</div>'
                + _atlas_badges(item)
                + "</li>"
                for item in region.items
            )
            count = len(region.items)
            region_html.append(
                '<section class="atlas-region">'
                '<header class="atlas-region-head">'
                f'<h3>{html.escape(region.name)}</h3>'
                f'<span class="atlas-region-count">{count} subsystem{"s" if count != 1 else ""}</span>'
                '</header>'
                f'<ul class="atlas-list">{items}</ul>'
                '</section>'
            )

        label = html.escape(block.caption, quote=True)
        regions = len(block.regions)
        return (
            f'<div class="subsystem-atlas" role="group" aria-label="{label}">'
            '<div class="atlas-summary">'
            f'<strong>{sum(len(region.items) for region in block.regions)} subsystems</strong>'
            f'<span>{regions} architectural region{"s" if regions != 1 else ""}</span>'
            '<span>Names open the subsystem report</span>'
            '</div>'
            f'<div class="atlas-regions">{"".join(region_html)}</div>'
            '</div>'
        )

    @staticmethod
    def _runtime_boundary_diagram(block: RuntimeDiagram) -> str:
        """Recorded runtime relations as inline SVG plus readable HTML."""

        def wrapped(value: Inlines, width: int) -> list[str]:
            plain = value.plain.strip() or "Not recorded"
            return textwrap.wrap(
                plain,
                width=width,
                break_long_words=False,
                break_on_hyphens=False,
            ) or [plain]

        def svg_text(
            lines: list[str],
            *,
            x: float,
            y: float,
            css_class: str,
            line_height: int,
            anchor: str = "start",
        ) -> str:
            tspans = "".join(
                f'<tspan x="{x:g}" dy="{0 if index == 0 else line_height}">'
                f'{html.escape(line)}</tspan>'
                for index, line in enumerate(lines)
            )
            return (
                f'<text class="{css_class}" x="{x:g}" y="{y:g}" '
                f'text-anchor="{anchor}">{tspans}</text>'
            )

        width = 960
        source_x, source_width = 24, 244
        target_x, target_width = 692, 244
        mechanism_x, mechanism_width = 308, 344
        current_y = 48
        svg_rows: list[str] = []
        details: list[str] = []

        for index, row in enumerate(block.rows):
            source, language, target, mechanism, note = (
                row.source, row.language, row.target, row.mechanism, row.note
            )
            source_lines = wrapped(source, 26)
            language_lines = wrapped(language, 32)
            target_lines = wrapped(target, 27)
            mechanism_lines = wrapped(mechanism, 42)

            source_height = 42 + 17 * len(source_lines) + 15 * len(language_lines)
            target_height = 42 + 17 * len(target_lines)
            mechanism_height = 22 + 15 * len(mechanism_lines)
            content_height = max(82, source_height, target_height, mechanism_height)
            lane_height = content_height + 24
            box_y = current_y + 12
            center_y = box_y + content_height / 2
            mechanism_y = center_y - mechanism_height / 2
            lane_class = "runtime-svg-lane-even" if index % 2 else "runtime-svg-lane"
            # A drawn runtime and a drawn edge name what the store holds (§3.5).
            source_node = _svg_mark("node", f"runtime:{row.source_node}" if row.source_node else "")
            target_node = _svg_mark("node", f"runtime:{row.target_node}" if row.target_node else "")
            edge_mark = _svg_mark("edge", row.record)

            svg_rows.append(
                f'<g class="runtime-svg-row">'
                f'<rect class="{lane_class}" x="0" y="{current_y:g}" '
                f'width="{width}" height="{lane_height:g}"/>'
                f'<rect class="runtime-svg-node" x="{source_x}" y="{box_y:g}" '
                f'width="{source_width}" height="{content_height:g}"{source_node}/>'
                f'<rect class="runtime-svg-node runtime-svg-target" x="{target_x}" y="{box_y:g}" '
                f'width="{target_width}" height="{content_height:g}"{target_node}/>'
                f'<line class="runtime-svg-edge" x1="{source_x + source_width}" y1="{center_y:g}" '
                f'x2="{target_x}" y2="{center_y:g}"{edge_mark}/>'
                f'<path class="runtime-svg-arrow" d="M {target_x:g} {center_y:g} '
                f'L {target_x - 10:g} {center_y - 5:g} L {target_x - 10:g} {center_y + 5:g} Z"{edge_mark}/>'
                f'<rect class="runtime-svg-edge-label" x="{mechanism_x}" y="{mechanism_y:g}" '
                f'width="{mechanism_width}" height="{mechanism_height:g}"/>'
                + svg_text(
                    source_lines,
                    x=source_x + 14,
                    y=box_y + 27,
                    css_class="runtime-svg-title",
                    line_height=17,
                )
                + svg_text(
                    language_lines,
                    x=source_x + 14,
                    y=box_y + 34 + 17 * len(source_lines),
                    css_class="runtime-svg-language",
                    line_height=15,
                )
                + svg_text(
                    target_lines,
                    x=target_x + 14,
                    y=box_y + 31,
                    css_class="runtime-svg-title",
                    line_height=17,
                )
                + svg_text(
                    mechanism_lines,
                    x=mechanism_x + mechanism_width / 2,
                    y=mechanism_y + 15,
                    css_class="runtime-svg-mechanism",
                    line_height=15,
                    anchor="middle",
                )
                + '</g>'
            )

            note_html = (
                '<p class="runtime-detail-note"><span class="runtime-detail-label">Recorded note</span>'
                f'{_inlines_html(note)}</p>'
                if note.plain.strip()
                else ""
            )
            details.append(
                "".join(row.markers)
                + f'<article class="runtime-detail" role="listitem"{_mark_attrs(row.record)}>'
                '<header class="runtime-detail-head">'
                f'<h3>{_inlines_html(source)}</h3>'
                f'<span class="runtime-detail-language">{_inlines_html(language)}</span></header>'
                '<div class="runtime-detail-body">'
                '<p><span class="runtime-detail-label">Communicates with</span>'
                f'{_inlines_html(target)}</p>'
                '<p><span class="runtime-detail-label">Mechanism</span>'
                f'{_inlines_html(mechanism)}</p>{note_html}</div></article>'
            )
            current_y += lane_height

        count = len(block.rows)
        boundary_word = "boundary" if count == 1 else "boundaries"
        svg_height = current_y
        svg = (
            f'<svg class="runtime-boundary-svg" xmlns="http://www.w3.org/2000/svg" '
            f'viewBox="0 0 {width} {svg_height}" role="img" '
            'aria-labelledby="runtime-boundary-svg-title runtime-boundary-svg-description">'
            '<title id="runtime-boundary-svg-title">Runtime boundary map</title>'
            f'<desc id="runtime-boundary-svg-description">{count} recorded runtime {boundary_word}; '
            'each row connects a runtime or process to its recorded target through the stated mechanism.</desc>'
            '<text class="runtime-svg-column-label" x="24" y="27">Runtime or process</text>'
            '<text class="runtime-svg-column-label" x="480" y="27" text-anchor="middle">Mechanism</text>'
            '<text class="runtime-svg-column-label" x="692" y="27">Communicates with</text>'
            + "".join(svg_rows)
            + '</svg>'
        )
        label = html.escape(block.caption or "runtime boundary map", quote=True)
        return (
            '<div class="runtime-boundary-projection">'
            f'<figure class="runtime-boundary-diagram" aria-label="{label}">'
            '<figcaption class="runtime-diagram-caption">'
            f'<strong>{count} recorded runtime {boundary_word}</strong>'
            '<span>Runtime → communication mechanism → recorded target</span>'
            '</figcaption>'
            f'<div class="runtime-svg-scroll">{svg}</div></figure>'
            '<div class="runtime-boundary-details" role="list" '
            'aria-label="Complete runtime boundary details">'
            + "".join(details)
            + '</div></div>'
        )

    @staticmethod
    def _diagram(block: Diagram) -> str:
        """A drawn figure with the account beside it, or the sentence that says why none is drawn (§7, Appendix B)."""

        if not block.nodes:
            subject_attr = f' data-subject="{html.escape(block.subject, quote=True)}"' if block.subject else ""
            # The sentence keeps the provenance a drawing would print (Appendix B rule 3).
            read_at = f' <span class="diagram-read-at">{html.escape(block.read_at, quote=False)}</span>' if block.read_at else ""
            return (
                f'<p class="diagram-below" data-diagram="{html.escape(block.kind, quote=True)}"{subject_attr}>'
                f"{html.escape(block.below, quote=False)}{read_at}</p>"
            )
        subject = f' data-subject="{html.escape(block.subject, quote=True)}"' if block.subject else ""

        def text(value: str) -> str:
            return html.escape(value, quote=False)

        items = "".join(
            f'<li id="{html.escape(anchor, quote=True)}">{text(line)}</li>' for anchor, line in block.items
        )
        account = (
            '<div class="diagram-account">'
            + "".join(f"<p>{text(paragraph)}</p>" for paragraph in block.account)
            + (f'<ol class="diagram-items">{items}</ol>' if items else "")
            + f'<p class="diagram-read-at">{text(block.read_at)}</p>'
            + "</div>"
        )
        return (
            f'<figure class="diagram" data-diagram="{html.escape(block.kind, quote=True)}"{subject}>'
            f'<figcaption><strong>{text(block.title)}</strong> <span>{text(block.caption)}</span></figcaption>'
            f'<div class="diagram-frame">{draw_svg(block)}</div>'
            f"{account}</figure>"
        )

    @staticmethod
    def _boundary_diagram(block: BoundaryDiagram) -> str:
        """Draw the recorded-boundary table as inline SVG (§2.5 item 2).

        Columns are layers in table order, eight to a band; boxes are in table
        order within a column. A line is drawn only for a row that names a seam
        or an outgoing xref, so nothing the table does not record is drawn.
        """
        box_w, box_h, gap_x, gap_y, margin, per_band = 200, 44, 64, 16, 24, 8
        layers: dict[str, list[str]] = {}
        names: dict[str, str] = {}
        touched: set[str] = set()
        seams: dict[str, tuple[str, str, str]] = {}
        xrefs: list[tuple[str, str, str, str]] = []
        badges: dict[str, tuple[Badge, ...]] = {}
        for row in block.rows:
            sid = row.subsystem_id
            if sid not in names:
                names[sid] = row.name
                badges[sid] = row.badges
                layers.setdefault(row.layer, []).append(sid)
            if not row.other_id:
                continue
            touched.add(sid)
            if row.seam:
                seams.setdefault(row.seam_id, (sid, row.other_id, row.record))
            elif row.relation.endswith("→"):
                xrefs.append((sid, row.other_id, row.relation.removesuffix("→").strip(), row.record))

        columns = list(layers)
        bands = [columns[i : i + per_band] for i in range(0, len(columns), per_band)]
        boxes: dict[str, tuple[int, int]] = {}
        parts_columns: list[str] = []
        band_top = 0
        for band in bands:
            for position, layer in enumerate(band):
                x = margin + position * (box_w + gap_x)
                parts_columns.append(
                    f'<text class="boundary-svg-column" x="{x}" y="{band_top + 30}">{html.escape(layer)}</text>'
                )
                for row_index, sid in enumerate(layers[layer]):
                    boxes[sid] = (x, band_top + 44 + row_index * (box_h + gap_y))
            tallest = max(len(layers[layer]) for layer in band)
            band_top += 44 + tallest * (box_h + gap_y) + 24
        width = 2 * margin + min(len(columns), per_band) * (box_w + gap_x) - gap_x
        height = band_top

        def ends(a: str, b: str) -> tuple[float, float, float, float]:
            (ax, ay), (bx, by) = boxes[a], boxes[b]
            if ax == bx:
                if ay < by:
                    return ax + box_w / 2, ay + box_h, bx + box_w / 2, by
                return ax + box_w / 2, ay, bx + box_w / 2, by + box_h
            if ax < bx:
                return ax + box_w, ay + box_h / 2, bx, by + box_h / 2
            return ax, ay + box_h / 2, bx + box_w, by + box_h / 2

        def num(value: float) -> str:
            return f"{round(value, 1):g}"

        lines: list[str] = []
        labels: list[str] = []
        for seam_id, (a, b, record) in seams.items():
            x1, y1, x2, y2 = ends(a, b)
            lines.append(
                f'<line class="boundary-svg-seam" x1="{num(x1)}" y1="{num(y1)}" x2="{num(x2)}" y2="{num(y2)}"{_svg_mark("edge", record)}/>'
            )
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            label_w = 12 + 6.4 * len(seam_id)
            labels.append(
                f'<rect class="boundary-svg-label-box" x="{num(mx - label_w / 2)}" y="{num(my - 8)}" '
                f'width="{num(label_w)}" height="16" rx="2"/>'
                f'<text class="boundary-svg-label" x="{num(mx)}" y="{num(my + 3.5)}">{html.escape(seam_id)}</text>'
            )
        for a, b, _relation, record in xrefs:
            x1, y1, x2, y2 = ends(a, b)
            length = max(((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5, 1.0)
            ux, uy = (x2 - x1) / length, (y2 - y1) / length
            edge_mark = _svg_mark("edge", record)
            lines.append(
                f'<line class="boundary-svg-xref" x1="{num(x1)}" y1="{num(y1)}" x2="{num(x2)}" y2="{num(y2)}"{edge_mark}/>'
                f'<path class="boundary-svg-arrow" d="M {num(x2)} {num(y2)} '
                f'L {num(x2 - 10 * ux - 5 * uy)} {num(y2 - 10 * uy + 5 * ux)} '
                f'L {num(x2 - 10 * ux + 5 * uy)} {num(y2 - 10 * uy - 5 * ux)} Z"{edge_mark}/>'
            )

        nodes: list[str] = []
        for sid, (x, y) in boxes.items():
            name = names[sid]
            shown = name if len(name) <= 28 else name[:27].rstrip() + "…"
            nodes.append(
                f'<g class="boundary-svg-node" data-subsystem="{html.escape(sid, quote=True)}"{_svg_mark("node", f"subsystem:{sid}")}>'
                f"<title>{html.escape(f'{sid} {name}')}</title>"
                f'<rect x="{x}" y="{y}" width="{box_w}" height="{box_h}" rx="3"/>'
                f'<text class="boundary-svg-id" x="{x + 10}" y="{y + 18}">{html.escape(sid)}</text>'
                f'<text class="boundary-svg-name" x="{x + 10}" y="{y + 35}">{html.escape(shown)}</text>'
                "</g>"
                + _boundary_badges(badges[sid], sid, x, y, box_w)
            )

        total = len(names)
        unconnected = total - len(touched)
        census = (
            f"{unconnected} of {total} subsystem{'s' if total != 1 else ''} "
            f"{'has' if unconnected == 1 else 'have'} no recorded boundary"
        )
        seam_count = f"{len(seams)} seam{'s' if len(seams) != 1 else ''} as labelled lines"
        xref_count = (
            f"{len(xrefs)} recorded dependenc{'ies' if len(xrefs) != 1 else 'y'} as arrows"
            if xrefs
            else ""
        )
        drawn = "; ".join(part for part in (seam_count, xref_count) if part)
        account = (
            "Each arrow is listed in the dependency graph above, and each seam line in the seam topology below"
            if xrefs
            else "Each line is listed in the seam topology below"
        )
        svg = (
            f'<svg class="boundary-svg" xmlns="http://www.w3.org/2000/svg" '
            f'viewBox="0 0 {width} {height}" width="{width}" height="{height}" role="img" '
            'aria-labelledby="boundary-svg-title boundary-svg-description">'
            '<title id="boundary-svg-title">Recorded boundaries</title>'
            f'<desc id="boundary-svg-description">{total} subsystems in {len(columns)} layer '
            f'column{"s" if len(columns) != 1 else ""}; {html.escape(drawn)}. {html.escape(census)}. '
            'No line is inferred from a name or a layer.</desc>'
            + "".join(parts_columns)
            + f'<g class="boundary-svg-lines">{"".join(lines)}</g>'
            + f'<g class="boundary-svg-nodes">{"".join(nodes)}</g>'
            + f'<g class="boundary-svg-labels">{"".join(labels)}</g>'
            + "</svg>"
        )
        label = html.escape(block.caption or "recorded boundaries", quote=True)
        return (
            '<div class="boundary-projection">'
            f'<figure class="boundary-diagram" aria-label="{label}">'
            '<figcaption class="runtime-diagram-caption">'
            "<strong>Recorded boundaries</strong>"
            f"<span>{html.escape(drawn)}</span>"
            f"<span>{html.escape(census)}</span>"
            f"<span>{account}</span>"
            "</figcaption>"
            f'<div class="boundary-svg-scroll">{svg}</div></figure></div>'
        )

    @staticmethod
    def _connection_topology(block: Topology) -> str:
        kind = block.kind
        nodes: dict[str, Inlines] = {}
        adjacency: dict[str, set[str]] = {}
        for edge in block.edges:
            nodes.setdefault(edge.left_id, edge.left)
            nodes.setdefault(edge.right_id, edge.right)
            adjacency.setdefault(edge.left_id, set()).add(edge.right_id)
            adjacency.setdefault(edge.right_id, set()).add(edge.left_id)
        edges = list(block.edges)

        components: list[set[str]] = []
        unseen = set(nodes)
        while unseen:
            start = min(unseen)
            component: set[str] = set()
            stack = [start]
            while stack:
                node = stack.pop()
                if node in component:
                    continue
                component.add(node)
                stack.extend(sorted(adjacency.get(node, set()) - component, reverse=True))
            unseen -= component
            components.append(component)
        components.sort(key=lambda component: (-len(component), min(component)))

        degree = {node: len(adjacency.get(node, set())) for node in nodes}
        component_html: list[str] = []
        for component_number, component in enumerate(components, start=1):
            hub = sorted(component, key=lambda node: (-degree[node], node))[0]
            component_edges = [
                edge for edge in edges
                if edge.left_id in component and edge.right_id in component
            ]
            spokes = [edge for edge in component_edges if hub in {edge.left_id, edge.right_id}]
            cross_edges = [edge for edge in component_edges if edge not in spokes]

            spoke_html: list[str] = []
            for edge in spokes:
                peer = edge.right_id if edge.left_id == hub else edge.left_id
                if edge.directed:
                    outbound = edge.left_id == hub
                    arrow = "→" if outbound else "←"
                    peer_label = "To" if outbound else "From"
                    direction = "Outgoing" if outbound else "Incoming"
                else:
                    arrow = "↔"
                    peer_label = "With"
                    direction = "Two-way seam"
                qualifier = (
                    f'<span class="topology-qualifier">{html.escape(direction)} · {_inlines_html(edge.qualifier)}</span>'
                    if edge.qualifier.plain
                    else f'<span class="topology-qualifier">{html.escape(direction)}</span>'
                )
                spoke_html.append(
                    "".join(edge.markers)
                    + '<article class="topology-spoke" role="listitem">'
                    f'<div class="topology-edge-mark" aria-hidden="true">{arrow}</div>'
                    '<div class="topology-edge-body">'
                    '<p class="topology-edge-head">'
                    f'<span class="topology-edge-key">{_inlines_html(edge.key)}</span>{qualifier}</p>'
                    f'<p class="topology-peer"><span class="topology-peer-label">{peer_label}</span>'
                    f'<span class="topology-node" data-identifier-defined>{_inlines_html(nodes[peer])}</span></p>'
                    f'<p class="topology-object">{_inlines_html(edge.detail)}</p>'
                    '</div></article>'
                )

            cross_html = ""
            if cross_edges:
                cross_items: list[str] = []
                for edge in cross_edges:
                    arrow = "→" if edge.directed else "↔"
                    qualifier = f' · {_inlines_html(edge.qualifier)}' if edge.qualifier.plain else ""
                    cross_items.append(
                        "".join(edge.markers)
                        + '<div class="topology-cross-edge">'
                        f'<span class="topology-node" data-identifier-defined>{_inlines_html(nodes[edge.left_id])}</span>'
                        '<span class="topology-cross-relation">'
                        f'<strong>{_inlines_html(edge.key)}</strong>{html.escape(arrow)}{qualifier}'
                        f'<span class="topology-cross-object">{_inlines_html(edge.detail)}</span>'
                        '</span>'
                        f'<span class="topology-node" data-identifier-defined>{_inlines_html(nodes[edge.right_id])}</span>'
                        '</div>'
                    )
                cross_html = (
                    '<div class="topology-cross"><p class="topology-cross-label">Other connection in this area</p>'
                    f'<div class="topology-cross-list">{"".join(cross_items)}</div></div>'
                )

            component_label = html.escape(f"Connected area {component_number}", quote=True)
            component_html.append(
                f'<section class="topology-component" aria-label="{component_label}">'
                '<header class="topology-hub">'
                f'<p class="topology-hub-label">Connected area {component_number} · hub</p>'
                f'<h3 class="topology-hub-title" data-identifier-defined>{_inlines_html(nodes[hub])}</h3>'
                f'<p class="topology-hub-count">{len(component)} subsystems · {len(component_edges)} connection{"s" if len(component_edges) != 1 else ""}</p>'
                '</header>'
                f'<div class="topology-spokes" role="list">{"".join(spoke_html)}</div>'
                + cross_html
                + '</section>'
            )

        noun = "seams" if kind == "seam" else "dependencies"
        label = html.escape(block.caption, quote=True)
        return (
            f'<div class="topology topology-{kind}" role="group" aria-label="{label}">'
            '<div class="topology-summary">'
            f'<strong>{len(components)} connected area{"s" if len(components) != 1 else ""}</strong>'
            f'<span>{len(nodes)} subsystems · {len(edges)} {noun}</span>'
            '<span>Follow any name to its subsystem report</span>'
            '</div>'
            + "".join(component_html)
            + '</div>'
        )

    def _coverage_index(self, block: CoverageIndex) -> str:
        """Sparse, task-oriented projection of the exact coverage matrix."""

        concern_codes = list(block.codes)
        totals = {key: 0 for key, _label, _mark in COVERAGE_STATES}
        linchpin_total = 0
        counts_by_row: list[dict[str, int]] = []
        for row in block.rows:
            counts: dict[str, int] = {}
            for review in row.reviews:
                counts[review.key] = counts.get(review.key, 0) + 1
                if review.key in totals:
                    totals[review.key] += 1
                if review.linchpin:
                    linchpin_total += 1
            counts_by_row.append(counts)

        review_total = sum(len(row.reviews) for row in block.rows)
        intersection_total = len(block.rows) * len(concern_codes)
        unassessed = intersection_total - review_total

        summary_items = (
            (review_total, "Recorded reviews"),
            (len(block.rows), "Subsystems"),
            (len(concern_codes), "Active concerns"),
            (totals.get("confirmed-bug", 0), "Confirmed defects"),
        )
        summary = "".join(
            '<div class="coverage-summary-item">'
            f'<strong>{value:,}</strong><span>{html.escape(label)}</span></div>'
            for value, label in summary_items
        )

        count_labels = {
            "confirmed-bug": lambda count: f"{count} defect{'s' if count != 1 else ''}",
            "confirmed-acceptable": lambda count: f"{count} accepted",
            "ruled-out": lambda count: f"{count} ruled out",
            "out-of-scope": lambda count: f"{count} out of scope",
            "unresolved-competition": lambda count: f"{count} unresolved",
            "unknown": lambda count: f"{count} recorded",
        }

        subsystem_items: list[str] = []
        matrix_rows: list[str] = []
        for row, counts in zip(block.rows, counts_by_row, strict=True):
            route = str((row.href if row.href is not None else self._route(row.subsystem_id)) or "")
            name = row.name
            subsystem_id = row.subsystem_id
            name_html = html.escape(name)
            primary = (
                f'<a href="{html.escape(route, quote=True)}">{name_html}</a>'
                if route
                else name_html
            )
            reviewed = len(row.reviews)
            progress = reviewed / len(concern_codes) * 100 if concern_codes else 0
            outcome_counts = "".join(
                f'<span class="coverage-state-{html.escape(key, quote=True)}">'
                f'{html.escape(count_labels[key](count))}</span>'
                for key in (
                    "confirmed-bug",
                    "unresolved-competition",
                    "confirmed-acceptable",
                    "ruled-out",
                    "out-of-scope",
                    "unknown",
                )
                if (count := counts.get(key, 0))
            )

            tokens: list[str] = []
            review_map = {review.code: review for review in row.reviews}
            matrix_cells: list[str] = []
            for code in concern_codes:
                review = review_map.get(code)
                if not review:
                    matrix_cells.append(
                        '<td class="coverage-matrix-empty"><span title="Not assessed">'
                        '<span aria-hidden="true">·</span><span class="visually-hidden">Not assessed</span>'
                        '</span></td>'
                    )
                    continue

                key, label, mark, linchpin = review.key, review.label, review.mark, review.linchpin
                destination = (
                    f'{route}#concern-disposition-{slugify(code)}' if route else f'#{slugify(code)}'
                )
                description = f"{code} — {label} in {name}"
                if linchpin:
                    description += "; linchpin-dependent"
                safe_description = html.escape(description, quote=True)
                linchpin_html = (
                    '<span class="coverage-linchpin" aria-hidden="true">◆</span>'
                    if linchpin
                    else ""
                )
                tokens.append(
                    f'<a class="coverage-token coverage-state-{html.escape(key, quote=True)}" '
                    f'href="{html.escape(destination, quote=True)}" title="{safe_description}" '
                    f'aria-label="{safe_description}">'
                    f'<span class="coverage-token-mark" aria-hidden="true">{html.escape(mark)}</span>'
                    f'<span>{html.escape(code)}</span>{linchpin_html}</a>'
                )
                matrix_cells.append(
                    f'<td class="coverage-matrix-cell coverage-state-{html.escape(key, quote=True)}">'
                    f'<a href="{html.escape(destination, quote=True)}" title="{safe_description}" '
                    f'aria-label="{safe_description}"><span class="coverage-matrix-mark" '
                    f'aria-hidden="true">{html.escape(mark)}</span>{linchpin_html}</a></td>'
                )

            marker_html = "".join(row.markers)
            subsystem_items.append(
                marker_html
                + '<article class="coverage-subsystem">'
                '<header class="coverage-subsystem-head">'
                f'<h3 class="coverage-subsystem-title">{primary}</h3>'
                f'<span class="coverage-subsystem-id" data-identifier-defined>{html.escape(subsystem_id)}</span></header>'
                '<div class="coverage-measure">'
                f'<p class="coverage-review-count">{reviewed} recorded review'
                f'{"s" if reviewed != 1 else ""} of {len(concern_codes)}</p>'
                f'<span class="coverage-progress" aria-hidden="true"><span style="width:{progress:.2f}%"></span></span>'
                f'<p class="coverage-outcome-counts">{outcome_counts}</p></div>'
                f'<div class="coverage-tokens" aria-label="Recorded concern reviews">{"".join(tokens)}</div>'
                '</article>'
            )
            matrix_rows.append(
                marker_html
                + '<tr><th scope="row">'
                + primary
                + f'<span class="coverage-matrix-subsystem-id" data-identifier-defined>{html.escape(subsystem_id)}</span></th>'
                + "".join(matrix_cells)
                + '</tr>'
            )

        legend = "".join(
            f'<span class="coverage-legend-item coverage-state-{html.escape(key, quote=True)}">'
            f'<span class="coverage-token-mark" aria-hidden="true">{html.escape(mark)}</span>'
            f'<span>{html.escape(label)}</span></span>'
            for key, label, mark in COVERAGE_STATES
        )
        legend += (
            '<span class="coverage-legend-item"><span class="coverage-linchpin" '
            'aria-hidden="true">◆</span><span>Linchpin-dependent</span></span>'
            '<span class="coverage-legend-item"><span class="coverage-matrix-empty" '
            'aria-hidden="true">·</span><span>Not assessed</span></span>'
        )

        matrix_head = "".join(
            f'<th scope="col"><a href="#{html.escape(slugify(code), quote=True)}">'
            f'{html.escape(code)}</a></th>'
            for code in concern_codes
        )
        matrix = (
            '<div class="table-wrap coverage-matrix-wrap"><table class="coverage-matrix">'
            '<caption>Full concern review matrix</caption><thead><tr><th scope="col">Subsystem</th>'
            + matrix_head
            + '</tr></thead><tbody>'
            + "".join(matrix_rows)
            + '</tbody></table></div>'
        )
        linchpin_note = (
            f" {linchpin_total} review{'s are' if linchpin_total != 1 else ' is'} linchpin-dependent."
            if linchpin_total
            else ""
        )
        return (
            '<div class="coverage-index">'
            f'<div class="coverage-summary">{summary}</div>'
            f'<p class="coverage-intro">Only the {review_total} recorded reviews are expanded below; '
            f'{unassessed:,} unassessed intersections do not consume reading space. The thin rule '
            'shows recorded coverage; the labelled markers show review outcomes.'
            f'{html.escape(linchpin_note)}</p>'
            f'<div class="coverage-subsystem-list">{"".join(subsystem_items)}</div>'
            f'<div class="coverage-legend" aria-label="Review outcome legend">{legend}</div>'
            '<details class="coverage-matrix-disclosure"><summary><span>Full cross-reference matrix</span>'
            f'<span>{len(block.rows)} subsystems × {len(concern_codes)} concerns</span></summary>'
            '<p class="coverage-matrix-note">Use the matrix when exact row-and-column comparison matters. '
            'Headers and subsystem names remain fixed while the matrix scrolls.</p>'
            + matrix
            + '</details></div>'
        )

    @staticmethod
    def _table(block: Table | EnumTable | LifecycleTable) -> str:
        lifecycle = isinstance(block, LifecycleTable)
        visible_headers = [header for index, header in enumerate(block.headers) if not lifecycle or index != 1]
        head = "".join(f'<th scope="col">{_inlines_html(cell)}</th>' for cell in visible_headers)
        table_rows: list[str] = []
        for row in block.rows:
            cells: list[str] = []
            for index, value in enumerate(row.cells):
                if lifecycle and index == 1:
                    continue
                label = block.headers[index].plain
                if lifecycle and index == 0:
                    location = row.cells[1]
                    location_html = (
                        f'<span class="table-detail"><span class="visually-hidden">Location: </span>{_inlines_html(location)}</span>'
                        if location.plain
                        else ""
                    )
                    cells.append(
                        f'<th scope="row" data-label="{html.escape(label, quote=True)}"><span class="table-key">{_inlines_html(value)}</span>{location_html}</th>'
                    )
                else:
                    cells.append(
                        f'<td data-label="{html.escape(label, quote=True)}">{_inlines_html(value)}</td>'
                    )
            row_attrs = ""
            if row.filter is not None:
                row_attrs = (
                    " data-filter-row"
                    f' data-filter-subsystem="{html.escape(row.filter.subsystem, quote=True)}"'
                    f' data-filter-severity="{html.escape(row.filter.severity, quote=True)}"'
                )
            row_attrs += _mark_attrs(row.record, row.state)
            table_rows.append("".join(row.markers) + f'<tr{row_attrs}>{"".join(cells)}</tr>')
        kind = " lifecycle-table" if lifecycle else ""
        return (
            f'<div class="table-wrap{kind}"><table><caption>{html.escape(block.caption)}</caption>'
            f'<thead><tr>{head}</tr></thead><tbody>{"".join(table_rows)}</tbody></table></div>'
        )

    def _heading(self, block: Heading) -> str:
        level = block.level
        anchor_id = self._unique_slug(block.text.plain)
        label = html.escape(f"Link to {block.text.plain}", quote=True)
        heading_class = ' class="finding-subsystem-heading"' if block.finding_group else ""
        definition_context = " data-identifier-defined" if block.finding_group else ""
        return (
            f'<h{level}{heading_class} id="{anchor_id}"{definition_context}>'
            f'<a class="heading-anchor" href="#{anchor_id}" aria-label="{label}">§</a>'
            f'{_inlines_html(block.text)}</h{level}>'
        )

    @staticmethod
    def _list(block: List) -> str:
        tag = "ol" if block.ordered else "ul"
        items = "".join(
            f"<li{_mark_attrs(item.record)}>{_inlines_html(item.text)}{''.join(_HtmlWriter._list(child) for child in item.children)}</li>"
            for item in block.items
        )
        return f"<{tag}>{items}</{tag}>"

    def _elements(self, blocks: tuple[Block, ...], out: list[str]) -> None:
        """Each block as one element, a section or disclosure as its open, its blocks and its close."""

        for block in blocks:
            if isinstance(block, Section):
                out.append(f'<section class="section-{html.escape(block.slug, quote=True)}">')
                self._elements(block.blocks, out)
                out.append("</section>")
            elif isinstance(block, Details):
                out.append(f'<details class="{html.escape(block.css_class, quote=True)}"><summary>{html.escape(block.summary)}</summary>')
                self._elements(block.blocks, out)
                out.append("</details>")
            elif isinstance(block, Marked):
                # Every element the record prints carries its mark, so the read-back can
                # gather its text without a wrapper changing the page's layout.
                inner: list[str] = []
                self._elements(block.blocks, inner)
                attrs = _mark_attrs(block.record, block.state)
                out.extend(_marked(element, attrs) for element in inner)
            else:
                out.append(self._block(block))

    def _block(self, block: Block) -> str:
        if isinstance(block, Heading):
            return self._heading(block)
        if isinstance(block, Paragraph):
            cls = f' class="{html.escape(block.css_class, quote=True)}"' if block.css_class else ""
            return f"<p{cls}>{_inlines_html(block.text)}</p>"
        if isinstance(block, List):
            return self._list(block)
        if isinstance(block, Quote):
            return f"<blockquote><p>{_inlines_html(block.text)}</p></blockquote>"
        if isinstance(block, Code):
            lang_class = f' class="language-{html.escape(block.language, quote=True)}"' if block.language else ""
            return f"<pre><code{lang_class}>{html.escape(block.source)}</code></pre>"
        if isinstance(block, Anchor):
            return f'<span id="{html.escape(block.id, quote=True)}" class="record-anchor"></span>'
        if isinstance(block, RecordMarker):
            return block.raw
        if isinstance(block, Table | EnumTable | LifecycleTable):
            return self._table(block)
        if isinstance(block, RecordList):
            return self._record_list(block)
        if isinstance(block, SummaryList):
            return self._summary_list(block)
        if isinstance(block, Atlas):
            return self._subsystem_atlas(block)
        if isinstance(block, Topology):
            return self._connection_topology(block)
        if isinstance(block, RuntimeDiagram):
            return self._runtime_boundary_diagram(block)
        if isinstance(block, BoundaryDiagram):
            return self._boundary_diagram(block)
        if isinstance(block, CoverageIndex):
            return self._coverage_index(block)
        if isinstance(block, ConcernChecklist):
            return self._concern_checklist(block)
        if isinstance(block, RelationshipTrace):
            return self._relationship_trace(block)
        if isinstance(block, StalenessBars):
            return self._staleness_bars(block)
        if isinstance(block, BadgeNote):
            return f'<p class="finding-badge-note">{html.escape(block.text, quote=False)}</p>'
        if isinstance(block, Diagram):
            return self._diagram(block)
        if isinstance(block, DiagramSource):
            return f'<figure class="figure"><figcaption class="figure-label">Diagram source</figcaption><pre class="diagram-source">{html.escape(block.source)}</pre></figure>'
        raise TypeError(f"not a block kind: {type(block).__name__}")

    def write(self, page: Page) -> str:
        elements: list[str] = []
        self._elements(page.blocks, elements)
        return "\n".join(_compose_prose_runs(elements))


def write_html(
    page: Page,
    route_map: dict[str, str] | None = None,
    repository_url: str | None = None,
    repository_ref: str | None = None,
    linkable_paths: frozenset[str] | None = None,
) -> str:
    """Print a page model's body as HTML (§3.1). It reads no Markdown."""

    return _HtmlWriter(route_map or {}, page.path, repository_url, repository_ref, linkable_paths).write(page)


class _IdentifierMarkup(HTMLParser):
    """Add semantic definitions to known opaque IDs in an HTML fragment."""

    # An SVG renders no HTML element, so an <abbr> in its <text> would hide
    # the ID it defines; the diagrams carry their own names.
    _PROTECTED = frozenset({"abbr", "script", "style", "svg"})
    _VOID = frozenset({
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr",
    })

    def __init__(self, definitions: dict[str, str]):
        super().__init__(convert_charrefs=False)
        self.definitions = definitions
        self.pattern = identifier_pattern(definitions)
        self.parts: list[str] = []
        self.protected_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.parts.append(self.get_starttag_text())
        is_contextual_definition = any(
            name == "data-identifier-defined" for name, _ in attrs
        )
        if self.protected_depth:
            if tag not in self._VOID:
                self.protected_depth += 1
        elif tag in self._PROTECTED or is_contextual_definition:
            self.protected_depth = 1

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del tag, attrs
        self.parts.append(self.get_starttag_text())

    def handle_endtag(self, tag: str) -> None:
        self.parts.append(f"</{tag}>")
        if self.protected_depth:
            self.protected_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.protected_depth or self.pattern is None:
            self.parts.append(data)
            return

        def replace(match: re.Match[str]) -> str:
            identifier = match.group(1)
            definition = self.definitions.get(identifier)
            if not definition:
                return identifier
            description = f"{identifier} — {definition}"
            escaped = html.escape(description, quote=True)
            return (
                f'<abbr class="identifier-definition" title="{escaped}" '
                f'aria-label="{escaped}">{html.escape(identifier)}</abbr>'
            )

        self.parts.append(self.pattern.sub(replace, data))

    def handle_entityref(self, name: str) -> None:
        self.parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.parts.append(f"&#{name};")

    def handle_comment(self, data: str) -> None:
        self.parts.append(f"<!--{data}-->")

    def handle_decl(self, decl: str) -> None:
        self.parts.append(f"<!{decl}>")

    def handle_pi(self, data: str) -> None:
        self.parts.append(f"<?{data}>")


def _identifier_markup(fragment: str, definitions: dict[str, str]) -> str:
    if not definitions:
        return fragment
    parser = _IdentifierMarkup(definitions)
    parser.feed(fragment)
    parser.close()
    return "".join(parser.parts)


def _page_eyebrow(page: SitePage) -> str:
    """The line above the title: where the page sits, each part its own label.

    A subsystem page names its layer and its id; an evidence matrix, its family
    and id; any other page, its navigation group. The page's status tag, when it
    has one, follows on the same line (`_shell`).
    """

    def part(text: str) -> str:
        return f'<p class="eyebrow">{text}</p>'

    if page.kind == "subsystem":
        record = html.escape(page.record_id or "record")
        layer = part(f"Layer · {html.escape(page.layer)}") if page.layer else ""
        return layer + part(f'Subsystem · <span data-identifier-defined>{record}</span>')
    if page.kind == "matrix":
        record = html.escape(page.record_id or "matrix")
        return part(f'Competing explanations · <span data-identifier-defined>{record}</span>')
    return part(html.escape(page.group))


def _nav_item(page: SitePage, current: SitePage) -> str:
    href = _rel_link(current.html_path, page.html_path)
    selected = ' aria-current="page"' if page.html_path == current.html_path else ""
    status_class = f" status-{page.status}" if page.status else ""
    record = (
        f'<span class="nav-id" data-identifier-defined>{html.escape(page.record_id)}</span>'
        if page.record_id
        else ""
    )
    search = " ".join(
        filter(None, (page.label, page.record_id, page.hint, page.status, page.subgroup))
    ).lower()
    title_attr = f' title="{html.escape(page.hint, quote=True)}"' if page.hint else ""
    return (
        f'<li class="nav-item" data-search="{html.escape(search, quote=True)}">'
        f'<a class="nav-link" href="{html.escape(href, quote=True)}"{title_attr}{selected}>'
        f'<span class="nav-tick{status_class}" aria-hidden="true"></span>'
        f'<span><span class="nav-name">{html.escape(page.label)}</span>{record}</span></a></li>'
    )


def _nav(pages: list[SitePage], current: SitePage) -> str:
    """The rail, in `NAV_GROUPS` order, subgroups last inside each group (§7.1).

    Group order is the constant's, not the page plan's append order, and a
    group the constant does not name never reaches here: `assert_nav_groups`
    refuses the plan first. Inside a group the pages that belong to it directly
    come first; each subgroup then follows under its own `<h3>`, so a reader
    scanning the rail meets the group's own pages before its divisions.
    """

    assert_nav_groups([(page.path, page.group) for page in pages])
    chunks: list[str] = []
    for group in NAV_GROUPS:
        items = [page for page in pages if page.group == group]
        if not items:
            continue
        direct = [page for page in items if not page.subgroup]
        subgroups: dict[str, list[SitePage]] = {}
        for page in items:
            if page.subgroup:
                subgroups.setdefault(page.subgroup, []).append(page)
        group_id = f"nav-group-{slugify(group)}"
        body = (
            f'<ul class="nav-list" aria-labelledby="{group_id}">'
            f'{"".join(_nav_item(page, current) for page in direct)}</ul>'
            if direct
            else ""
        )
        for subgroup, members in subgroups.items():
            subgroup_id = f"{group_id}-{slugify(subgroup)}"
            body += (
                f'<div class="nav-subgroup">'
                f'<h3 class="nav-subgroup-title" id="{subgroup_id}">{html.escape(subgroup)}</h3>'
                f'<ul class="nav-list" aria-labelledby="{subgroup_id}">'
                f'{"".join(_nav_item(page, current) for page in members)}</ul></div>'
            )
        chunks.append(
            f'<section class="nav-group">'
            f'<h2 class="nav-group-title" id="{group_id}">{html.escape(group)}</h2>'
            f"{body}</section>"
        )
    return "".join(chunks)


def _shell(
    page: SitePage,
    pages: list[SitePage],
    source_title: str,
    body: str,
    context: dict[str, Any],
    filters: tuple[str, dict[str, list[str]]] | None = None,
    notice: str = "",
) -> str:
    canonical = str(context.get("canonical_branch") or "not recorded")
    project_name = str(context.get("project_name") or "Project")
    checked = str(context.get("last_checked_sha") or "")
    checked_at = str(context.get("last_checked_at") or "not recorded")
    # Freshness is read from `file_ledger`, under the names `get_dashboard`
    # returns, so the strip and the tool cannot disagree about one store
    # (§11.2).  An empty ledger is reported as absent measurement: a projection
    # cannot tell a conspectus with nothing stale from one where nothing ever
    # recorded staleness, and must not assert the stronger of the two (B03-2).
    stale_entries = int(context.get("stale_entries") or 0)
    stale_exempt = int(context.get("stale_exempt") or 0)
    scoped_files = int(context.get("scoped_files") or 0)
    if not context.get("staleness_measured"):
        freshness_label = "Freshness not measured by this projection"
        freshness_class = "freshness unmeasured"
    else:
        freshness_label = (
            f"Stale: {stale_entries} with a survey obligation,"
            f" {stale_exempt} exempt, of {scoped_files} scoped files"
        )
        # Source alignment is a relationship between the record and the
        # repository, so only a file the survey owes a reading breaks it; drift
        # in generated or vendored territory is reported, not counted against it.
        freshness_class = "freshness stale" if stale_entries else "freshness"
    display_title = page.title or source_title
    hint_para = f'<p class="page-hint">{html.escape(page.hint)}</p>' if page.hint else ""
    help_markup = _page_help(page)
    notice_para = (
        f'<p class="page-notice">{html.escape(notice)}</p>' if notice else ""
    )
    home_link = _rel_link(page.html_path, "index.html")
    record_status = _status_html(page.status, show_hint=False) if page.status else ""
    # The tag beside the page's id names its status by what it is, in its title:
    # a subsystem's survey depth, an evidence matrix's outcome. A subsystem page
    # prints its depth only here, so the tag carries the record mark (§3.5).
    status_label, status_mark = _STRIP_STATUS.get(page.kind, ("Status", False))
    mark = (
        _mark_attrs(f"subsystem:{page.record_id}", str(page.status))
        if status_mark and page.record_id
        else ""
    )
    status_meta = (
        f'<span class="page-status" title="{html.escape(status_label, quote=True)}"{mark}>{record_status}</span>'
        if record_status
        else ""
    )
    definitions = {
        str(identifier): str(definition)
        for identifier, definition in dict(
            context.get("identifier_definitions") or {}
        ).items()
    }
    # Every result's target is a projection-root-relative path, and a page in a
    # subdirectory has to reach it from where it sits; the prefix is computed
    # once here rather than guessed by the script from `location`.
    root_prefix = home_link[: -len("index.html")]
    index_href = _rel_link(page.html_path, SEARCH_INDEX_PATH)
    # The facets this page's rows carry, stamped where the script can read them
    # without a second pass over the DOM (§8.1.2). A page with no filterable
    # row carries nothing, so no control is built for it.
    scope, facets = filters or ("", {})
    filter_attrs = ""
    if scope and facets:
        filter_attrs = f' data-filter-scope="{html.escape(scope, quote=True)}"'
        for key, values in sorted(facets.items()):
            if values:
                filter_attrs += (
                    f' data-facet-{html.escape(key, quote=True)}='
                    f'"{html.escape("|".join(values), quote=True)}"'
                )
    nav = _identifier_markup(_nav(pages, page), definitions)
    body = _identifier_markup(body, definitions)
    eyebrow = _identifier_markup(_page_eyebrow(page), definitions)
    return _PAGE_TEMPLATE.substitute(
        generator=HTML_PROJECTION_VERSION,
        description=html.escape(page.hint or display_title, quote=True),
        title=html.escape(display_title),
        project=html.escape(project_name),
        project_attr=html.escape(project_name, quote=True),
        stylesheet=html.escape(_rel_link(page.html_path, SITE_CSS_PATH), quote=True),
        script=html.escape(_rel_link(page.html_path, SITE_JS_PATH), quote=True),
        search_index=html.escape(index_href, quote=True),
        root=html.escape(root_prefix, quote=True),
        home=html.escape(home_link, quote=True),
        nav=nav,
        eyebrow=eyebrow + status_meta,
        hint=hint_para,
        help=help_markup,
        notice=notice_para,
        branch=html.escape(canonical),
        checked=html.escape(checked[:12] or "not recorded"),
        checked_at=html.escape(checked_at),
        freshness_class=freshness_class,
        freshness=html.escape(freshness_label),
        kind=html.escape(slugify(page.kind), quote=True),
        filters=filter_attrs,
        body=body,
    )


def render_search_index(locus_index: dict[str, Any] | None) -> str:
    """Serialize the locus index as the one assignment §8.1.1 fixes.

    Data only: it assigns a single global and runs nothing, so a reader with
    scripts disabled loses the search and nothing else. The envelope is stable
    so the read-back state axis can parse it back without executing it.
    """

    index = locus_index or {}
    payload = json.dumps(
        {
            "paths": list(index.get("paths") or []),
            "symbols": list(index.get("symbols") or []),
        },
        separators=(",", ":"),
    )
    return (
        "/* Amanuensis locus index — generated with the projection, and covered\n"
        "   by the same publication receipt. Data only: one global, no behaviour. */\n"
        f"window.__amanuensisLocusIndex = {payload};\n"
    )


def render_html_projection(
    output: Path,
    pages: list[SitePage],
    context: dict[str, Any],
    previous_files: dict[str, str] | None = None,
    locus_index: dict[str, Any] | None = None,
    notice: str = "",
    models: dict[str, Page] | None = None,
) -> HtmlProjectionResult:
    """Print each page's HTML from its model and retire old HTML.

    `models` holds the pages the renderers built, by plan id, after the
    cross-reference pass. `notice` is the command-line render notice; the HTML
    prints it in the page head.
    """

    previous_files = previous_files or {}
    models = models or {}
    route_map = {
        page.record_id: page.html_path
        for page in pages
        if page.record_id
    }
    files: dict[str, str] = {}
    warnings: list[str] = []
    rendered = 0
    unchanged = 0

    # The index is a projection file like any other: written here, hashed into
    # `files`, and therefore recorded in `manifest.projection_files` and in the
    # publication receipt the caller writes from it (§8.2).
    # It is not an HTML page, so it is written without touching the page
    # counters: `html_pages_rendered` and `html_pages_unchanged` are read
    # against `html_pages_total`, which counts the page plan.
    index_text = render_search_index(locus_index)
    index_target = output / SEARCH_INDEX_PATH
    files[SEARCH_INDEX_PATH] = sha256_bytes(index_text.encode("utf-8"))
    if not index_target.is_file() or index_target.read_text() != index_text:
        index_target.parent.mkdir(parents=True, exist_ok=True)
        index_target.write_text(index_text)

    prose_links = source_links(context)

    for rel, text in SITE_ASSETS.items():
        target = output / rel
        files[rel] = sha256_bytes(text.encode("utf-8"))
        if not target.is_file() or target.read_text() != text:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)

    readme_target = output / README_PATH
    files[README_PATH] = sha256_bytes(README_TEXT.encode("utf-8"))
    if not readme_target.is_file() or readme_target.read_text() != README_TEXT:
        readme_target.write_text(README_TEXT)

    for page in pages:
        model = models.get(page.path)
        if model is None:
            warnings.append(f"HTML source missing for {page.path}")
            continue
        # Prose prints the repository paths it names as links to the host.
        held = _SOURCE_LINKS.set(prose_links)
        try:
            body = write_html(
                model,
                route_map,
                repository_url=str(context.get("repository_url") or "") or None,
                repository_ref=str(context.get("repository_ref") or "") or None,
                linkable_paths=linkable_of(context),
            )
        finally:
            _SOURCE_LINKS.reset(held)
        facets = model.facets
        document = _shell(
            page,
            pages,
            model.title,
            body,
            context,
            (facets.scope, dict(facets.values)) if facets else ("", {}),
            notice,
        )
        target = output / page.html_path
        digest = sha256_bytes(document.encode("utf-8"))
        files[page.html_path] = digest
        if target.is_file() and sha256_bytes(target.read_bytes()) == digest:
            unchanged += 1
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(document)
        rendered += 1

    retired: list[str] = []
    for rel in sorted(set(previous_files) - set(files)):
        target = output / rel
        if target.is_file():
            target.unlink()
        retired.append(rel)
    return HtmlProjectionResult(
        files=files,
        rendered=rendered,
        unchanged=unchanged,
        retired=retired,
        warnings=warnings,
    )
