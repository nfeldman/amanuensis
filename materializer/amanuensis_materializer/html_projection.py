"""Self-contained HTML projection for the human-facing conspectus.

HTML is the only published view (store-only PLAN §3.2).  This module turns each
page's model, built by its renderer and linked by the cross-reference pass, into a
dependency-free HTML site with global navigation, reader hints, semantic
status labels, and local-link integrity.  Every page embeds the same compact
CSS and JavaScript so the projection works from ``file://`` as well as from a
static web server.

A page is a model of the blocks of `page.py`, and `write_html` prints those blocks.
No Markdown is read here: the one Markdown reader left is `legacy_prose.py`, for
the bodies an earlier version had the survey write by hand.
"""

from __future__ import annotations

import html
import json
import posixpath
import re
import textwrap
from collections.abc import Sequence
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import quote

from .manifest import sha256_bytes
from .page import (
    COVERAGE_STATES,
    Abbr,
    Anchor,
    Atlas,
    Block,
    BoundaryDiagram,
    Break,
    Chip,
    Code,
    CodeSpan,
    ConcernChecklist,
    CoverageIndex,
    Details,
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
# in the store (PLAN §5 D6, O15). The overview's Publication integrity block reads
# the store's last recorded run, so it cannot describe this render; each page says
# so instead. The second form is for a render that skipped its read-back.
CLI_RENDER_NOTICE = (
    "Rendered from the command line. Its read-back was not recorded in the survey's"
    " record, so the Publication integrity figures on the overview describe an earlier"
    " publication."
)
CLI_RENDER_NOTICE_UNVERIFIED = "Rendered from the command line and not read back."
CLI_RENDER_NOTICES = (CLI_RENDER_NOTICE, CLI_RENDER_NOTICE_UNVERIFIED)


def cli_render_notice(*, recorded: bool, verified: bool) -> str:
    """The notice a render's pages carry; empty when the caller records the read-back."""

    if recorded:
        return ""
    return CLI_RENDER_NOTICE if verified else CLI_RENDER_NOTICE_UNVERIFIED


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




_CSS = r"""
:root {
  color-scheme: light dark;
  --canvas: #f3f4ef;
  --canvas-subtle: #eaeae6;
  --surface: #fbfcf7;
  --text: #1d261b;
  --text-muted: #596153;
  --text-subtle: #7a8273;
  --rule: #cdd1c5;
  --rule-strong: #a4ac9d;
  --accent: #48651f;
  --accent-strong: #314a16;
  --accent-soft: #e4ebd3;
  --signal: #9b5b27;
  --quiet: #697263;
  --survey-unmapped: #858b81;
  --survey-scoping: #75836d;
  --survey-structural: #637a55;
  --survey-concerns: #536f3f;
  --survey-adversarial: #42672a;
  --survey-mapped: #315c18;
  --survey-deferred: #7a7e75;
  --severity-low: #767b75;
  --severity-medium: #b07b00;
  --severity-high: #bd5217;
  --severity-critical: #aa2438;
  --evidence-code: #3f611f;
  --evidence-contract: #4d6a31;
  --evidence-test: #5b7343;
  --evidence-config: #687a56;
  --evidence-doc: #737f65;
  --evidence-comment: #7b8471;
  --evidence-name: #82887a;
  --evidence-pattern: #878b83;
  --disposition-defect: #aa2438;
  --disposition-acceptable: #4b6b2e;
  --disposition-ruled-out: #616b5c;
  --disposition-out-of-scope: #7d8380;
  --disposition-ambiguous: #6f5b76;
  --resolution-open: #98532f;
  --resolution-pending: #806c27;
  --resolution-closed: #3f6428;
  --resolution-accepted: #5a7043;
  --source-aligned: #607446;
  --source-stale: #98532f;
  --heading: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
  --body: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --rail: 17.25rem;
  --measure: 120ch;
  --page: 128rem;
  --baseline: .25rem;
}

:root[data-theme="dark"] {
  --canvas: #171a15;
  --canvas-subtle: #131510;
  --surface: #20231d;
  --text: #edf0e6;
  --text-muted: #b7bdac;
  --text-subtle: #929989;
  --rule: #3b4234;
  --rule-strong: #5d6651;
  --accent: #b4d35d;
  --accent-strong: #d5e88b;
  --accent-soft: #35431f;
  --signal: #d5a064;
  --quiet: #a3aa98;
  --survey-unmapped: #9ba093;
  --survey-scoping: #a0ad83;
  --survey-structural: #a5b977;
  --survey-concerns: #aac56a;
  --survey-adversarial: #b1d05e;
  --survey-mapped: #b8dc55;
  --survey-deferred: #9a9e95;
  --severity-low: #a0a8a3;
  --severity-medium: #e2bf4f;
  --severity-high: #f09a58;
  --severity-critical: #f27b88;
  --evidence-code: #b4d171;
  --evidence-contract: #afc775;
  --evidence-test: #abc078;
  --evidence-config: #a6b67c;
  --evidence-doc: #a3ae82;
  --evidence-comment: #a0a789;
  --evidence-name: #9ea18f;
  --evidence-pattern: #9b9d94;
  --disposition-defect: #f27b88;
  --disposition-acceptable: #afd378;
  --disposition-ruled-out: #a6ae9c;
  --disposition-out-of-scope: #8e9692;
  --disposition-ambiguous: #b7a0bd;
  --resolution-open: #d99468;
  --resolution-pending: #c6ad61;
  --resolution-closed: #b0d775;
  --resolution-accepted: #bdcf98;
  --source-aligned: #b3c581;
  --source-stale: #d99468;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --canvas: #171a15; --canvas-subtle: #131510; --surface: #20231d;
    --text: #edf0e6; --text-muted: #b7bdac; --text-subtle: #929989;
    --rule: #3b4234; --rule-strong: #5d6651;
    --accent: #b4d35d; --accent-strong: #d5e88b; --accent-soft: #35431f;
    --signal: #d5a064; --quiet: #a3aa98;
    --survey-unmapped: #9ba093; --survey-scoping: #a0ad83;
    --survey-structural: #a5b977; --survey-concerns: #aac56a;
    --survey-adversarial: #b1d05e; --survey-mapped: #b8dc55; --survey-deferred: #9a9e95;
    --severity-low: #a0a8a3; --severity-medium: #e2bf4f;
    --severity-high: #f09a58; --severity-critical: #f27b88;
    --evidence-code: #b4d171; --evidence-contract: #afc775; --evidence-test: #abc078;
    --evidence-config: #a6b67c; --evidence-doc: #a3ae82; --evidence-comment: #a0a789;
    --evidence-name: #9ea18f; --evidence-pattern: #9b9d94;
    --disposition-defect: #f27b88; --disposition-acceptable: #afd378;
    --disposition-ruled-out: #a6ae9c; --disposition-out-of-scope: #8e9692;
    --disposition-ambiguous: #b7a0bd;
    --resolution-open: #d99468; --resolution-pending: #c6ad61;
    --resolution-closed: #b0d775; --resolution-accepted: #bdcf98;
    --source-aligned: #b3c581; --source-stale: #d99468;
  }
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; background: var(--canvas-subtle); }
body {
  margin: 0;
  color: var(--text);
  background: var(--canvas);
  font-family: var(--body);
  font-size: 1rem;
  line-height: 1.58;
  font-kerning: normal;
  font-optical-sizing: auto;
  font-synthesis: none;
  font-variant-ligatures: common-ligatures contextual;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent-strong); text-decoration-thickness: .08em; text-underline-offset: .18em; }
a:hover { text-decoration-thickness: .14em; }
a:focus-visible, button:focus-visible, input:focus-visible, summary:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 3px;
}

.skip-link {
  position: fixed; left: 1rem; top: -5rem; z-index: 100;
  padding: .55rem .8rem; background: var(--text); color: var(--canvas);
}
.skip-link:focus { top: 1rem; }
.shell { min-height: 100vh; }
.nav-rail {
  position: fixed; inset: 0 auto 0 0; width: var(--rail); z-index: 20;
  display: flex; flex-direction: column; overflow-y: auto;
  padding: 2rem 1.35rem 1.5rem;
  background: var(--canvas-subtle); border-right: 1px solid var(--rule);
}
.brand { display: block; color: var(--text); text-decoration: none; margin: 0 0 1.6rem; }
.brand-mark {
  display: block; font: 600 1.35rem/1.05 var(--heading); letter-spacing: -.015em;
}
.brand-sub { display: block; margin-top: .32rem; color: var(--text-muted); font: .73rem/1.4 var(--body); }
.search-label { display: block; margin-bottom: .35rem; color: var(--text-muted); font: .67rem/1.2 var(--mono); letter-spacing: .07em; text-transform: uppercase; }
.nav-search {
  width: 100%; padding: .55rem .65rem; color: var(--text); background: var(--surface);
  border: 1px solid var(--rule-strong); border-radius: 0; font: .82rem/1.3 var(--body);
}
.nav-search::placeholder { color: var(--text-subtle); }
.rail-nav { margin-top: 1.5rem; }
.nav-group { margin: 0 0 1.35rem; }
.nav-group-title {
  margin: 0 0 .32rem; color: var(--text-subtle);
  font: 600 .64rem/1.3 var(--mono); letter-spacing: .1em; text-transform: uppercase;
}
.nav-list { list-style: none; margin: 0; padding: 0; }
.nav-item { margin: .08rem 0; }
.nav-subgroup { margin: .5rem 0 0; }
.nav-subgroup-title {
  margin: 0 0 .2rem .45rem; color: var(--text-subtle);
  font: 600 .62rem/1.3 var(--mono); letter-spacing: .08em; text-transform: uppercase;
}
.nav-item[hidden], .nav-group[hidden], .nav-subgroup[hidden] { display: none; }
.nav-link { display: grid; grid-template-columns: .55rem 1fr; gap: .48rem; padding: .5rem .45rem; color: var(--text-muted); text-decoration: none; border-radius: 0; }
.nav-link:hover { color: var(--text); background: var(--surface); }
.nav-link[aria-current="page"] { color: var(--accent-strong); }
.nav-link[aria-current="page"] .nav-name { font-weight: 700; }
.nav-tick { width: .34rem; height: .34rem; margin-top: .44rem; border: 1px solid var(--rule-strong); background: transparent; }
.nav-link[aria-current="page"] .nav-tick { border-color: var(--accent); background: var(--accent); }
.nav-tick.status-unmapped { border-color: var(--survey-unmapped); }
.nav-tick.status-scoping { background: var(--survey-scoping); border-color: var(--survey-scoping); }
.nav-tick.status-structural { background: var(--survey-structural); border-color: var(--survey-structural); }
.nav-tick.status-concerns { background: var(--survey-concerns); border-color: var(--survey-concerns); }
.nav-tick.status-adversarial { background: var(--survey-adversarial); border-color: var(--survey-adversarial); }
.nav-tick.status-mapped { background: var(--survey-mapped); border-color: var(--survey-mapped); }
.nav-tick.status-deferred { border-color: var(--survey-deferred); border-style: dashed; }
.nav-name { display: block; font-size: .82rem; line-height: 1.3; }
.nav-id { display: block; margin-top: .12rem; color: var(--text-subtle); font: .64rem/1.3 var(--mono); }
.rail-foot { margin-top: auto; padding-top: 1.5rem; }
.rail-actions { display: flex; gap: .5rem; align-items: center; }
.quiet-button {
  border: 1px solid var(--rule); padding: .36rem .5rem; color: var(--text-muted);
  background: transparent; border-radius: 0; cursor: pointer; font: .68rem/1 var(--mono);
}
.quiet-button:hover { border-color: var(--accent); color: var(--accent-strong); }
.rail-note { margin: .7rem 0 0; color: var(--text-subtle); font: .64rem/1.45 var(--mono); }

.document { margin-left: var(--rail); min-height: 100vh; background: var(--surface); }
.mobile-bar { display: none; }
.document-inner { width: min(100%, var(--page)); margin: 0 auto; padding: 4.5rem clamp(2rem, 5vw, 6.5rem) 5.5rem; }
.page-head { padding: 0 0 2.25rem; border-bottom: 1px solid var(--rule); }
.eyebrow { margin: 0 0 1rem; color: var(--accent); font: 650 .69rem/1.3 var(--mono); letter-spacing: .11em; text-transform: uppercase; }
h1 {
  margin: 0; font: 600 clamp(2.8rem, 4.8vw, 5.2rem)/.98 var(--heading);
  letter-spacing: -.042em; text-wrap: balance;
  font-variant-ligatures: common-ligatures discretionary-ligatures;
}
.page-use-when { max-width: none; margin: .4rem 0 0; color: var(--text-muted); font: clamp(.95rem, .3vw + .88rem, 1.1rem)/1.5 var(--body); text-wrap: pretty; }
.page-terms { max-width: none; margin: .4rem 0 0; color: var(--text-muted); font: .85rem/1.6 var(--body); }
.page-terms a { color: var(--accent); }
.page-notice { max-width: none; margin: .9rem 0 0; padding: .45rem .75rem; border-left: 2px solid var(--signal); color: var(--text-muted); font: .85rem/1.55 var(--body); }
.page-hint { max-width: none; margin: 1.1rem 0 0; color: var(--text-muted); font: italic clamp(1.05rem, .45vw + .94rem, 1.3rem)/1.48 var(--heading); text-wrap: pretty; }
.snapshot-strip { display: flex; flex-wrap: wrap; gap: .55rem 1.2rem; margin-top: 1.3rem; padding: .7rem .85rem; background: var(--canvas); border: 1px solid var(--rule); border-radius: 0; }
.snapshot-item { color: var(--text-muted); font: .7rem/1.45 var(--mono); }
.snapshot-item b { color: var(--text); font-weight: 650; }
.freshness { display: inline-flex; gap: .38rem; align-items: center; }
.freshness::before { content: ""; width: .45rem; height: .45rem; background: var(--source-aligned); border-radius: 50%; }
.freshness.stale::before { background: var(--source-stale); }
.freshness.unmeasured::before { background: var(--rule-strong); }

.content { max-width: 100%; padding-top: .35rem; container: report / inline-size; }
.content > section { position: relative; padding: 3rem 0; border-bottom: 1px solid var(--rule); }
.content > section:last-child { border-bottom: 0; }
.content-findings > section { padding: 2.4rem 0 .6rem; border-bottom: 0; }
.content-findings .section-open { --enum-color: var(--resolution-open); }
.content-findings .section-awaiting-verification { --enum-color: var(--resolution-pending); }
.content-findings .section-verified-fixed { --enum-color: var(--resolution-closed); }
.content-findings .section-ruled-out, .content-findings .section-accepted {
  --enum-color: var(--resolution-accepted);
}
.content-findings section > h3 { --enum-color: var(--rule-strong); }
.content-findings .section-open > h3, .content-findings .section-awaiting-verification > h3 {
  border-left: .14em solid var(--enum-color); padding-left: .5rem;
}
.content-findings section > h2::before {
  content: ""; display: inline-block; width: .14em; height: .72em;
  margin-right: .42em; background: var(--enum-color); vertical-align: .02em;
}
.finding-subsystem-heading {
  margin: 2rem 0 .55rem;
  color: var(--text);
  font: 600 clamp(1.25rem, 1.6vw, 1.6rem)/1.25 var(--heading);
}
.finding-subsystem-heading a { color: inherit; text-decoration-color: var(--rule-strong); }
.finding-subsystem-heading + .record-list-finding { margin-top: 0; }
.content > p, .content > ul, .content > ol, .content > blockquote { margin-left: 0; }
h2, h3, h4, h5, h6 { position: relative; color: var(--text); text-wrap: balance; scroll-margin-top: 1.5rem; }
h2 { margin: 0 0 1.25rem; font: 600 clamp(1.7rem, 1.2vw + 1.25rem, 2.15rem)/1.12 var(--heading); letter-spacing: -.018em; }
h3 { margin: 2.1rem 0 .7rem; font: 650 1.05rem/1.3 var(--body); }
h4 { margin: 1.65rem 0 .55rem; color: var(--accent-strong); font: 650 .9rem/1.35 var(--body); }
h5, h6 { margin: 1.4rem 0 .5rem; font-size: .85rem; }
.heading-anchor { position: absolute; left: -1.2rem; color: var(--text-subtle); text-decoration: none; opacity: 0; font-family: var(--mono); }
:is(h2,h3,h4,h5,h6):hover .heading-anchor, .heading-anchor:focus { opacity: 1; }
p { max-width: var(--measure); margin: 0 0 1rem; }
strong { font-weight: 680; }
em { font-family: var(--heading); }
code {
  padding: .08rem .25rem; color: var(--accent-strong); background: var(--accent-soft);
  font: .82em/1.4 var(--mono); overflow-wrap: anywhere;
}
ul, ol { max-width: var(--measure); margin: .4rem 0 1.2rem; padding-left: 1.35rem; }
li { padding-left: .25rem; margin: 0 0 .48rem; }
li::marker { color: var(--accent); }
blockquote { max-width: var(--measure); margin: 1.2rem 0; padding: .25rem 0 .25rem 1.2rem; border-left: 3px solid var(--accent); color: var(--text-muted); }
blockquote p { margin: 0; font: italic 1rem/1.58 var(--heading); }
.raw-prose-note { border-left-color: var(--signal); }

.prose-flow {
  max-width: var(--measure);
  margin: 1rem 0 1.5rem;
  orphans: 3;
  widows: 3;
}
.prose-flow > p {
  max-width: none;
  margin: 0 0 1em;
  hyphens: auto;
  text-wrap: pretty;
}
.prose-flow > p:last-child { margin-bottom: 0; }

.table-wrap { width: 100%; margin: 1.1rem 0 1.5rem; overflow-x: auto; border: 1px solid var(--rule); border-radius: 0; }
table { width: 100%; border-collapse: collapse; font-size: .86rem; line-height: 1.48; }
caption { padding: .55rem 0; color: var(--text-subtle); text-align: left; font: .65rem/1.3 var(--mono); letter-spacing: .07em; text-transform: uppercase; }
th { padding: .6rem .7rem; color: var(--text-muted); border-bottom: 1px solid var(--rule-strong); text-align: left; vertical-align: bottom; font: 650 .65rem/1.35 var(--mono); letter-spacing: .06em; text-transform: uppercase; }
td { padding: .7rem; border-bottom: 1px solid var(--rule); text-align: left; vertical-align: top; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: color-mix(in srgb, var(--accent-soft) 35%, transparent); }
td:first-child, th:first-child { padding-left: .7rem; }
.section-current-state .table-wrap { max-width: 54rem; }
.section-current-state table { font-size: .92rem; }
.section-current-state td:last-child { font-family: var(--mono); font-variant-numeric: tabular-nums; }

.coverage-index { margin: 1.1rem 0 1.8rem; }
.coverage-summary {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  border-top: 1px solid var(--rule-strong); border-bottom: 1px solid var(--rule-strong);
}
.coverage-summary-item { min-width: 0; padding: .85rem 1rem; border-right: 1px solid var(--rule); }
.coverage-summary-item:last-child { border-right: 0; }
.coverage-summary-item strong { display: block; font: 600 1.45rem/1 var(--heading); }
.coverage-summary-item span { display: block; margin-top: .32rem; color: var(--text-subtle); font: .61rem/1.35 var(--mono); letter-spacing: .06em; text-transform: uppercase; }
.coverage-intro { max-width: var(--measure); margin: 1rem 0 1.25rem; color: var(--text-muted); }
.coverage-subsystem-list {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid var(--rule-strong); border-left: 1px solid var(--rule);
}
.coverage-subsystem {
  display: grid; grid-template-columns: minmax(12rem, .82fr) minmax(0, 1.18fr);
  gap: .7rem 1rem; align-content: start; min-width: 0; padding: .8rem 1rem;
  border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
}
.coverage-subsystem-head { min-width: 0; }
.coverage-subsystem-title { margin: 0; font: 650 .9rem/1.32 var(--body); text-wrap: pretty; }
.coverage-subsystem-title a { color: inherit; text-decoration-color: var(--rule-strong); }
.coverage-subsystem-id { display: block; margin-top: .22rem; color: var(--text-subtle); font: .62rem/1.3 var(--mono); }
.coverage-measure { min-width: 0; }
.coverage-review-count { margin: 0; color: var(--text-muted); font: .67rem/1.35 var(--mono); }
.coverage-progress { display: block; height: .22rem; margin-top: .42rem; background: var(--canvas-subtle); }
.coverage-progress > span { display: block; height: 100%; background: var(--accent); }
.coverage-outcome-counts { display: flex; flex-wrap: wrap; gap: .28rem .7rem; margin: .48rem 0 0; color: var(--text-subtle); font: .61rem/1.35 var(--mono); }
.coverage-outcome-counts span::before { content: ""; display: inline-block; width: .42rem; height: .42rem; margin-right: .28rem; background: var(--enum-color); }
.coverage-state-confirmed-bug { --enum-color: var(--disposition-defect); }
.coverage-state-confirmed-acceptable { --enum-color: var(--disposition-acceptable); }
.coverage-state-ruled-out { --enum-color: var(--disposition-ruled-out); }
.coverage-state-out-of-scope { --enum-color: var(--disposition-out-of-scope); }
.coverage-state-unresolved-competition { --enum-color: var(--disposition-ambiguous); }
.coverage-state-unknown { --enum-color: var(--quiet); }
.coverage-tokens { display: flex; flex-wrap: wrap; align-items: flex-start; align-self: start; gap: .32rem; grid-column: 1 / -1; }
.coverage-token {
  display: inline-flex; align-items: center; gap: .3rem; min-height: 1.65rem;
  padding: .22rem .38rem; border: 1px solid var(--rule); color: var(--text-muted);
  background: var(--surface); text-decoration: none; font: .63rem/1.15 var(--mono);
}
.coverage-token:hover, .coverage-token:focus-visible { border-color: var(--enum-color); color: var(--text); }
.coverage-token-mark, .coverage-matrix-mark {
  display: inline-grid; place-items: center; width: 1.05rem; height: 1.05rem;
  color: var(--enum-color); border: 1px solid currentColor; font: 700 .62rem/1 var(--mono);
}
.coverage-linchpin { color: var(--accent); font-size: .58rem; }
.coverage-legend { display: flex; flex-wrap: wrap; gap: .48rem 1rem; margin: .85rem 0 0; color: var(--text-muted); font: .63rem/1.4 var(--mono); }
.coverage-legend-item { display: inline-flex; align-items: center; gap: .35rem; color: var(--text-muted); }
.coverage-matrix-disclosure { margin-top: 1.15rem; border-top: 1px solid var(--rule-strong); border-bottom: 1px solid var(--rule-strong); }
.coverage-matrix-disclosure > summary { display: flex; justify-content: space-between; gap: 1rem; padding: .8rem .1rem; cursor: pointer; font-weight: 650; }
.vocabulary-disclosure { margin-top: 1rem; border-top: 1px solid var(--rule-strong); border-bottom: 1px solid var(--rule-strong); }
.vocabulary-disclosure > summary { padding: .8rem .1rem; cursor: pointer; font-weight: 650; }
.coverage-matrix-disclosure > summary span:last-child { color: var(--text-subtle); font: .62rem/1.4 var(--mono); font-weight: 400; }
.coverage-matrix-note { max-width: var(--measure); margin: 0 0 .8rem; color: var(--text-muted); font-size: .8rem; }
.coverage-matrix-wrap { max-height: min(72vh, 56rem); margin: 0 0 1rem; }
.coverage-matrix { width: max-content; min-width: 100%; table-layout: fixed; }
.coverage-matrix th, .coverage-matrix td { text-align: center; }
.coverage-matrix thead th { position: sticky; top: 0; z-index: 3; min-width: 2.65rem; padding: .5rem .35rem; background: var(--canvas); }
.coverage-matrix thead th:first-child { left: 0; z-index: 5; min-width: 18rem; text-align: left; }
.coverage-matrix tbody th { position: sticky; left: 0; z-index: 2; width: 18rem; max-width: 18rem; padding: .5rem .65rem; background: var(--surface); text-align: left; text-transform: none; letter-spacing: 0; font: 650 .75rem/1.3 var(--body); }
.coverage-matrix tbody th a { color: inherit; text-decoration-color: var(--rule-strong); }
.coverage-matrix-subsystem-id { display: block; margin-top: .12rem; color: var(--text-subtle); font-size: .58rem; }
.coverage-matrix td { width: 2.65rem; height: 2.25rem; padding: .25rem; }
.coverage-matrix td > a { display: inline-grid; place-items: center; color: inherit; text-decoration: none; }
.coverage-matrix-empty { color: var(--rule-strong); font-family: var(--mono); }

.record-list { margin: 1.1rem 0 1.6rem; border-top: 1px solid var(--rule-strong); border-bottom: 1px solid var(--rule-strong); }
.record {
  display: grid; grid-template-columns: minmax(11.5rem, .34fr) minmax(0, 1fr);
  border-bottom: 1px solid var(--rule);
}
.record:last-child { border-bottom: 0; }
.record-meta { min-width: 0; padding: 1rem; background: var(--canvas-subtle); border-right: 1px solid var(--rule); }
.record-primary { margin: 0; color: var(--text); font: 600 1.08rem/1.25 var(--heading); overflow-wrap: anywhere; }
.record-primary code { font-size: .75rem; }
.record-facts { margin: .7rem 0 0; }
.record-facts > div { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: .55rem; align-items: center; padding: .23rem 0; }
.record-facts dt, .record-label { color: var(--text-subtle); font: 600 .62rem/1.35 var(--mono); letter-spacing: .07em; text-transform: uppercase; }
.record-facts dd { min-width: 0; margin: 0; color: var(--text-muted); font-size: .75rem; line-height: 1.45; overflow-wrap: anywhere; }
.record-facts :is(.status, .evidence-label, .severity) { max-width: none; white-space: nowrap; overflow-wrap: normal; }
.record-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); min-width: 0; }
.record-field { min-width: 0; padding: 1rem 1.1rem; border-right: 1px solid var(--rule); }
.record-field:last-child { border-right: 0; }
.record-field:nth-child(n + 3) { border-top: 1px solid var(--rule); }
.record-label { margin: 0 0 .48rem; }
.record-copy { color: var(--text); line-height: 1.55; }
.record-copy code { overflow-wrap: anywhere; }
.record-body { min-width: 0; padding: 1.15rem 1.25rem 1.3rem; }
.record-lede { max-width: var(--measure); margin: 0 0 1.25rem; color: var(--text); font: 600 1.15rem/1.38 var(--heading); }
h1, h2, .brand-mark, .record-primary, .record-lede {
  font-kerning: normal;
  font-variant-ligatures: common-ligatures discretionary-ligatures;
  font-feature-settings: "kern" 1, "liga" 1, "clig" 1;
  text-rendering: optimizeLegibility;
}
.record-finding { display: block; }
.record-finding .record-meta {
  display: grid; grid-template-columns: minmax(5.5rem, max-content) minmax(0, 1fr);
  gap: .65rem 1.25rem; align-items: center;
  padding: .85rem 1rem; border-right: 0; border-bottom: 1px solid var(--rule);
}
.record-finding .record-primary { align-self: start; margin-top: .08rem; }
.record-finding .record-facts {
  display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: .4rem 1rem;
  align-items: center; min-width: 0; margin: 0;
}
.record-finding .record-facts > div {
  display: flex; gap: .35rem; align-items: center;
  min-width: 0; padding: 0;
}
.record-finding .record-facts dd { overflow-wrap: normal; }
.record-finding .record-fact-ref-sha code { white-space: nowrap; overflow-wrap: normal; }
.record-finding .record-fact-status { justify-self: start; }
.record-finding .record-fact-ref-sha { justify-self: end; }
.record-finding .record-fact-status dt,
.record-finding .record-fact-ref-sha dt {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
.record-finding .record-fields { display: block; }
.record-finding .record-field { max-width: var(--measure); padding: 1rem 0 0; border: 0; border-top: 1px solid var(--rule); }
.record-finding .record-field + .record-field { margin-top: 1rem; }
.record-file-ledger { grid-template-columns: minmax(14rem, .42fr) minmax(0, 1fr); }
.record-file-ledger .record-fields, .record-structural-inventory .record-fields, .record-concern-disposition .record-fields { grid-template-columns: minmax(0, 1fr); }
.record-concern .record-fields, .record-territory .record-fields, .record-finding-summary .record-fields,
.record-open-question .record-fields, .record-seam .record-fields { grid-template-columns: minmax(0, 1fr); }
.record-concern-disposition { display: block; }
.record-concern-disposition .record-meta {
  display: grid; grid-template-columns: minmax(5.5rem, max-content) minmax(0, 1fr);
  gap: .8rem 1.5rem; align-items: start;
  padding: .9rem 1rem; border-right: 0; border-bottom: 1px solid var(--rule);
}
.record-concern-disposition .record-primary { margin-top: .1rem; }
.record-concern-disposition .record-facts {
  display: flex; flex-wrap: wrap; gap: .48rem 1.35rem; align-items: center;
  min-width: 0; margin: 0;
}
.record-concern-disposition .record-facts > div {
  display: grid; grid-template-columns: auto auto; gap: .45rem;
  align-items: center; min-width: max-content; padding: 0;
}
.record-concern-disposition .record-facts dd { overflow-wrap: normal; }
.concern-family { margin: 2rem 0 2.6rem; }
.concern-family-heading {
  display: flex; flex-wrap: wrap; gap: .45rem .8rem; align-items: baseline;
  margin: 0 0 .55rem; color: var(--text); font: 600 1.35rem/1.25 var(--heading);
}
.concern-territory { color: var(--text-subtle); font: .62rem/1.4 var(--mono); letter-spacing: .06em; text-transform: uppercase; }
.record-list-concern-checklist { margin-top: 0; }
.record-concern-checklist { display: block; }
.record-concern-checklist .record-meta {
  display: grid; grid-template-columns: max-content minmax(0, 1fr);
  gap: .6rem 1.25rem; align-items: center;
  padding: .72rem 1rem; border-right: 0; border-bottom: 1px solid var(--rule);
}
.record-concern-checklist .record-primary { font-size: 1rem; }
.record-concern-checklist .record-facts { min-width: 0; margin: 0; }
.record-concern-checklist .record-facts > div {
  display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .25rem .5rem;
  align-items: baseline; min-width: 0; padding: 0;
}
.record-concern-checklist .record-facts dd { overflow-wrap: normal; }
.record-concern-checklist .record-body { padding: 1rem 1.1rem 1.15rem; }
.record-probe { max-width: var(--measure); color: var(--text); font-size: .86rem; line-height: 1.58; }
.record-file-ledger .record-primary code { color: var(--text); background: transparent; padding: 0; font: 600 .95rem/1.3 var(--heading); }
.file-source-link { color: inherit; text-decoration-color: var(--rule-strong); }
.file-source-link::after { content: " ↗"; color: var(--accent); font: .68rem/1 var(--mono); }
.identifier-definition {
  color: inherit;
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-thickness: .06em;
  text-underline-offset: .2em;
  cursor: help;
}
a .identifier-definition { text-decoration-color: currentColor; }
.record-subsystem { display: block; }
.record-subsystem .record-meta { padding: 1.05rem 1rem .85rem; background: transparent; border-right: 0; border-bottom: 1px solid var(--rule); }
.record-subsystem .record-primary { max-width: 48ch; font-size: 1.25rem; }
.record-primary-link { color: inherit; text-decoration-color: var(--rule-strong); }
.record-subsystem .record-facts { display: flex; flex-wrap: wrap; gap: .35rem 1rem; align-items: center; margin-top: .55rem; }
.record-subsystem .record-facts > div { display: flex; grid-template-columns: none; gap: .35rem; align-items: baseline; padding: 0; }
.record-subsystem .record-facts dt { font-size: .58rem; }
.record-subsystem .record-facts dd { font-size: .7rem; }
.record-subsystem .record-fact-id dt, .record-subsystem .record-fact-status dt { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.record-subsystem .record-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }

.summary-list { max-width: 54rem; margin: 1rem 0 1.5rem; border-top: 1px solid var(--rule-strong); }
.summary-list > div { display: grid; grid-template-columns: minmax(10rem, .42fr) minmax(0, 1fr); border-bottom: 1px solid var(--rule); }
.summary-list dt, .summary-list dd { margin: 0; padding: .65rem .75rem; }
.summary-list dt { color: var(--text-muted); font-weight: 650; }
.summary-list dd { border-left: 1px solid var(--rule); }

.runtime-boundary-projection { margin: 1.2rem 0 1.8rem; border-bottom: 1px solid var(--rule-strong); }
.runtime-boundary-diagram { margin: 0; }
.runtime-diagram-caption {
  display: flex; flex-wrap: wrap; gap: .45rem 1rem; align-items: baseline;
  padding: .65rem 0; border-top: 1px solid var(--rule-strong); border-bottom: 1px solid var(--rule);
  color: var(--text-muted); font-size: .78rem;
}
.runtime-diagram-caption strong { color: var(--text); font: 600 1rem/1.3 var(--heading); }
.runtime-svg-scroll { max-width: 100%; overflow-x: auto; border-bottom: 1px solid var(--rule); }
.runtime-boundary-svg { display: block; width: 100%; min-width: 52rem; height: auto; background: var(--surface); }
.runtime-svg-lane { fill: color-mix(in srgb, var(--canvas-subtle) 44%, transparent); }
.runtime-svg-lane-even { fill: color-mix(in srgb, var(--canvas-subtle) 72%, transparent); }
.runtime-svg-node { fill: var(--surface); stroke: var(--rule-strong); stroke-width: 1; }
.runtime-svg-target { fill: var(--canvas-subtle); }
.runtime-svg-edge { stroke: var(--accent); stroke-width: 1.5; }
.runtime-svg-arrow { fill: var(--accent); }
.runtime-svg-edge-label { fill: var(--surface); stroke: var(--rule-strong); stroke-width: 1; }
.runtime-svg-column-label {
  fill: var(--text-subtle); font: 600 10px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase;
}
.runtime-svg-title { fill: var(--text); font: 600 14px/1.3 var(--heading); }
.runtime-svg-language { fill: var(--text-muted); font: 11px/1.3 var(--mono); }
.runtime-svg-mechanism { fill: var(--accent-strong); font: 600 11px/1.3 var(--mono); text-anchor: middle; }
.runtime-boundary-details { display: grid; }
.boundary-projection { margin: 1.2rem 0 1.8rem; border-bottom: 1px solid var(--rule-strong); }
.boundary-diagram { margin: 0; }
.boundary-svg-scroll { max-width: 100%; overflow-x: auto; }
.boundary-svg { display: block; max-width: none; height: auto; background: var(--surface); }
.boundary-svg-node { fill: var(--surface); stroke: var(--rule-strong); stroke-width: 1; }
.boundary-svg-seam { stroke: var(--text-subtle); stroke-width: 1.25; }
.boundary-svg-xref { stroke: var(--accent); stroke-width: 1.5; }
.boundary-svg-arrow { fill: var(--accent); }
.boundary-svg-label-box { fill: var(--surface); stroke: var(--rule-strong); stroke-width: 1; }
.boundary-svg-label { fill: var(--text-muted); font: 600 10px/1 var(--mono); text-anchor: middle; }
.boundary-svg-column {
  fill: var(--text-subtle); font: 600 10px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase;
}
.boundary-svg-id { fill: var(--text); font: 600 12px/1.2 var(--mono); }
.boundary-svg-name { fill: var(--text-muted); font: 12px/1.2 var(--heading); }
.runtime-detail {
  display: grid; grid-template-columns: minmax(12rem, .8fr) minmax(0, 1.2fr);
  min-width: 0; border-bottom: 1px solid var(--rule);
}
.runtime-detail:last-child { border-bottom: 0; }
.runtime-detail:focus-within, .runtime-detail:hover { background: color-mix(in srgb, var(--accent-soft) 24%, transparent); }
.runtime-detail-head { min-width: 0; padding: .72rem .85rem; background: var(--canvas-subtle); border-right: 1px solid var(--rule); }
.runtime-detail-head h3 { margin: 0; color: var(--text); font: 600 .88rem/1.35 var(--heading); }
.runtime-detail-language { display: block; margin-top: .28rem; color: var(--text-muted); font: .64rem/1.35 var(--mono); }
.runtime-detail-body { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); min-width: 0; }
.runtime-detail-body p { min-width: 0; margin: 0; padding: .66rem .78rem; border-right: 1px solid var(--rule); }
.runtime-detail-body p:nth-child(2) { border-right: 0; }
.runtime-detail-body .runtime-detail-note { grid-column: 1 / -1; border-top: 1px solid var(--rule); border-right: 0; }
.runtime-detail-label {
  display: block; margin-bottom: .2rem; color: var(--text-subtle);
  font: 600 .58rem/1.3 var(--mono); letter-spacing: .08em; text-transform: uppercase;
}

.subsystem-atlas { margin: 1.2rem 0 1.7rem; }
.atlas-summary, .topology-summary {
  display: flex; flex-wrap: wrap; gap: .45rem 1rem; align-items: baseline;
  padding: .65rem 0; border-top: 1px solid var(--rule-strong); border-bottom: 1px solid var(--rule);
  color: var(--text-muted); font-size: .78rem;
}
.atlas-summary strong, .topology-summary strong { color: var(--text); font: 600 1rem/1.3 var(--heading); }
.atlas-regions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; border-left: 1px solid var(--rule); }
.atlas-region { min-width: 0; border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
.atlas-region-head {
  display: flex; justify-content: space-between; gap: 1rem; align-items: baseline;
  padding: .7rem .8rem; background: var(--canvas-subtle); border-bottom: 1px solid var(--rule);
}
.atlas-region-head h3 { margin: 0; color: var(--text); font: 600 .86rem/1.3 var(--heading); }
.atlas-region-count { color: var(--text-subtle); font: .62rem/1.3 var(--mono); }
.atlas-list { max-width: none; margin: 0; padding: 0; list-style: none; }
.atlas-item {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .7rem; align-items: start;
  min-height: 3.25rem; margin: 0; padding: .68rem .8rem; border-bottom: 1px solid var(--rule);
}
.atlas-item:last-child { border-bottom: 0; }
.atlas-item:focus-within, .atlas-item:hover { background: color-mix(in srgb, var(--accent-soft) 32%, transparent); }
.atlas-subsystem { min-width: 0; color: var(--text-muted); font-size: .76rem; line-height: 1.38; }
.atlas-subsystem strong { display: block; margin-bottom: .13rem; font: 650 .7rem/1.25 var(--mono); }
.atlas-depth .status { padding: .08rem .28rem; font-size: .58rem; }

.topology { margin: 1.2rem 0 1.8rem; border-bottom: 1px solid var(--rule-strong); }
.topology-component {
  display: grid; grid-template-columns: minmax(13rem, .32fr) minmax(0, 1fr);
  border-bottom: 1px solid var(--rule-strong);
}
.topology-component:last-child { border-bottom: 0; }
.topology-hub { min-width: 0; padding: 1rem; background: var(--canvas-subtle); border-right: 1px solid var(--rule); }
.topology-hub-label, .topology-cross-label {
  margin: 0 0 .48rem; color: var(--text-subtle);
  font: 600 .61rem/1.35 var(--mono); letter-spacing: .08em; text-transform: uppercase;
}
.topology-hub-title { margin: 0; color: var(--text-muted); font: .83rem/1.42 var(--body); }
.topology-hub-title strong { display: block; margin-bottom: .2rem; font: 650 .78rem/1.25 var(--mono); }
.topology-hub-count { margin: .7rem 0 0; color: var(--text-subtle); font: .64rem/1.4 var(--mono); }
.topology-spokes { min-width: 0; }
.topology-spoke {
  display: grid; grid-template-columns: 3.1rem minmax(0, 1fr); min-width: 0;
  border-bottom: 1px solid var(--rule);
}
.topology-spoke:last-child { border-bottom: 0; }
.topology-spoke:focus-within, .topology-spoke:hover { background: color-mix(in srgb, var(--accent-soft) 28%, transparent); }
.topology-edge-mark {
  display: flex; align-items: center; justify-content: center; min-height: 5.1rem;
  color: var(--accent); border-right: 1px solid var(--rule); font: 1.2rem/1 var(--heading);
}
.topology-edge-body { min-width: 0; padding: .78rem .9rem .85rem; }
.topology-edge-head { display: flex; flex-wrap: wrap; gap: .4rem .65rem; align-items: baseline; margin: 0 0 .25rem; }
.topology-edge-key { color: var(--accent-strong); font: 650 .7rem/1.3 var(--mono); }
.topology-qualifier { color: var(--text-subtle); font: .61rem/1.3 var(--mono); }
.topology-peer { margin: 0 0 .32rem; color: var(--text-muted); font-size: .8rem; }
.topology-peer-label { margin-right: .28rem; color: var(--text-subtle); font: .61rem/1.3 var(--mono); text-transform: uppercase; }
.topology-peer strong { font-family: var(--mono); font-size: .72rem; }
.topology-object { max-width: 64ch; margin: 0; color: var(--text); font-size: .86rem; line-height: 1.5; }
.topology-cross { grid-column: 1 / -1; padding: .8rem 1rem 1rem; background: color-mix(in srgb, var(--canvas-subtle) 55%, transparent); border-top: 1px solid var(--rule); }
.topology-cross-list { display: grid; gap: .55rem; }
.topology-cross-edge { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: .7rem; align-items: center; }
.topology-cross-edge .topology-node:last-child { text-align: right; }
.topology-cross-relation { min-width: 7rem; color: var(--text-subtle); text-align: center; font: .62rem/1.35 var(--mono); }
.topology-cross-relation strong { display: block; color: var(--accent-strong); }
.topology-cross-object { display: block; max-width: 42ch; margin-top: .18rem; color: var(--text-muted); font-family: var(--body); font-size: .72rem; }

.table-key { display: block; color: var(--text); font: 650 .76rem/1.35 var(--mono); letter-spacing: 0; text-transform: none; }
.table-detail { display: block; margin-top: .28rem; color: var(--text-subtle); font: .68rem/1.4 var(--mono); letter-spacing: 0; text-transform: none; overflow-wrap: anywhere; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

.status, .evidence-label, .severity {
  --enum-color: var(--quiet);
  display: inline-flex; align-items: center; gap: .38rem; padding: .16rem .46rem;
  color: color-mix(in srgb, var(--enum-color) 72%, var(--text));
  background: color-mix(in srgb, var(--enum-color) 10%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--enum-color) 68%, var(--rule));
  border-radius: 0; white-space: nowrap; font: 650 .68rem/1.3 var(--mono); letter-spacing: .015em;
}
.status::before, .severity::before, .evidence-label::before { content: ""; flex: 0 0 auto; width: .43rem; height: .43rem; border-radius: 50%; background: var(--enum-color); }
.status-unmapped { --enum-color: var(--survey-unmapped); }
.status-scoping { --enum-color: var(--survey-scoping); }
.status-structural { --enum-color: var(--survey-structural); }
.status-concerns { --enum-color: var(--survey-concerns); }
.status-adversarial { --enum-color: var(--survey-adversarial); }
.status-mapped { --enum-color: var(--survey-mapped); }
.status-deferred { --enum-color: var(--survey-deferred); border-style: dashed; }
.status-confirmed-bug { --enum-color: var(--disposition-defect); }
.status-confirmed-acceptable { --enum-color: var(--disposition-acceptable); }
.status-ruled-out { --enum-color: var(--disposition-ruled-out); }
.status-out-of-scope { --enum-color: var(--disposition-out-of-scope); border-style: dashed; }
.status-unresolved-competition { --enum-color: var(--disposition-ambiguous); }
.status-open { --enum-color: var(--resolution-open); }
.status-fixed-pending-verification { --enum-color: var(--resolution-pending); }
.status-fixed, .status-resolved, .status-verified-fixed { --enum-color: var(--resolution-closed); }
.status-accepted { --enum-color: var(--resolution-accepted); }
.severity-critical { --enum-color: var(--severity-critical); }
.severity-high { --enum-color: var(--severity-high); }
.severity-medium { --enum-color: var(--severity-medium); }
.severity-low { --enum-color: var(--severity-low); }
.evidence-label { border-style: dotted; }
.evidence-code-verified { --enum-color: var(--evidence-code); }
.evidence-contract-stated { --enum-color: var(--evidence-contract); }
.evidence-test-observed { --enum-color: var(--evidence-test); }
.evidence-config-asserted { --enum-color: var(--evidence-config); }
.evidence-doc-asserted { --enum-color: var(--evidence-doc); }
.evidence-comment-asserted { --enum-color: var(--evidence-comment); }
.evidence-name-inferred { --enum-color: var(--evidence-name); }
.evidence-pattern-matched { --enum-color: var(--evidence-pattern); }

.figure { margin: 1.4rem 0 1.7rem; padding: 1rem 0 1.15rem; border-top: 1px solid var(--rule-strong); border-bottom: 1px solid var(--rule-strong); }
.figure-label { margin: 0 0 .9rem; color: var(--text-subtle); font: .65rem/1.35 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
.relationship-map { display: grid; gap: .55rem; }
.relationship { display: grid; grid-template-columns: minmax(8rem, 1fr) 3.5rem minmax(8rem, 1fr); gap: .65rem; align-items: center; }
.relationship-node { display: block; min-width: 0; padding: .65rem .75rem; border-left: 3px solid var(--accent); background: var(--canvas-subtle); text-decoration: none; }
.relationship-node strong { display: block; color: var(--accent-strong); font: .74rem/1.3 var(--mono); }
.relationship-node span { display: block; margin-top: .16rem; color: var(--text-muted); font-size: .78rem; overflow-wrap: anywhere; }
.relationship-edge { color: var(--text-subtle); text-align: center; font: .62rem/1.15 var(--mono); }
.relationship-edge b { display: block; color: var(--accent); font-size: 1.1rem; font-weight: 400; }
.bar-chart { display: grid; gap: .6rem; }
.bar-row { display: grid; grid-template-columns: minmax(7rem, 12rem) 1fr 3rem; gap: .7rem; align-items: center; }
.bar-label, .bar-value { font: .7rem/1.3 var(--mono); }
.bar-track { height: .5rem; background: var(--canvas-subtle); }
.bar-fill { height: 100%; background: var(--accent); }
.diagram-source, pre:not(.diagram-source) { max-width: 100%; overflow-x: auto; margin: 1rem 0; padding: 1rem; border: 1px solid var(--rule); border-radius: 0; background: var(--canvas-subtle); color: var(--text); font: .75rem/1.55 var(--mono); white-space: pre-wrap; }

.page-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1rem; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--rule); color: var(--text-subtle); font: .65rem/1.5 var(--mono); }
.page-foot p { margin: 0; max-width: 52rem; }
.page-foot a { color: inherit; }
[hidden] { display: none !important; }

/* Search results and the in-page filters. Ruled registers, not cards: a row
   per result, one rule between them, no icon and no badge (§8.3). Every one of
   these elements is built by script; nothing here is served hidden. */
.search-status { margin: .55rem 0 0; color: var(--text-subtle); font: .68rem/1.4 var(--mono); }
.search-status:empty { display: none; }
.search-results { margin: .5rem 0 0; padding: 0; max-height: 18rem; overflow-y: auto; list-style: none; border-top: 1px solid var(--rule); }
.search-results:empty { display: none; border-top: 0; }
.search-option { display: grid; grid-template-columns: 4.1rem 1fr; gap: .1rem .55rem; padding: .45rem .1rem; border-bottom: 1px solid var(--rule); cursor: pointer; }
.search-option[aria-selected="true"] { background: var(--canvas-subtle); box-shadow: inset 2px 0 0 var(--accent); }
.search-option-kind { grid-row: 1 / span 2; color: var(--text-subtle); font: .6rem/1.5 var(--mono); letter-spacing: .07em; text-transform: uppercase; }
.search-option-label { color: var(--text); font: .74rem/1.4 var(--mono); overflow-wrap: anywhere; }
.search-option-detail { grid-column: 2; color: var(--text-muted); font-size: .68rem; overflow-wrap: anywhere; }
.filter-controls { display: flex; flex-wrap: wrap; align-items: baseline; gap: .65rem 1.4rem; margin: 0 0 1.6rem; padding: .85rem 0 .95rem; border: 0; border-top: 1px solid var(--rule-strong); border-bottom: 1px solid var(--rule-strong); }
.filter-controls legend { padding: 0 .6rem 0 0; color: var(--text-subtle); font: .62rem/1.35 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
.filter-facet { display: flex; flex-wrap: wrap; align-items: baseline; gap: .35rem .6rem; }
.filter-label { color: var(--text-muted); font: .68rem/1.5 var(--mono); }
.filter-options { display: flex; flex-wrap: wrap; gap: .3rem .9rem; }
.filter-option { display: inline-flex; align-items: baseline; gap: .3rem; font-size: .75rem; }
.filter-select { padding: .2rem .3rem; border: 1px solid var(--rule-strong); border-radius: 0; background: var(--surface); color: var(--text); font: .75rem/1.4 var(--body); }
.filter-status { flex-basis: 100%; margin: 0; color: var(--text-subtle); font: .68rem/1.4 var(--mono); }

@media (max-width: 900px) {
  .nav-rail { position: static; inset: auto; width: auto; max-height: none; }
  .js .nav-rail { position: fixed; inset: 0 auto 0 0; width: var(--rail); transform: translateX(-102%); transition: transform .18s ease; box-shadow: 0 0 0 999px transparent; }
  .js body.nav-open .nav-rail { transform: translateX(0); box-shadow: 0 0 0 999px color-mix(in srgb, var(--text) 28%, transparent); }
  .document { margin-left: 0; }
  .js .mobile-bar { position: sticky; top: 0; z-index: 15; display: flex; justify-content: space-between; align-items: center; padding: .7rem 1rem; background: var(--surface); border-bottom: 1px solid var(--rule); }
  :is(h2, h3, h4, h5, h6) { scroll-margin-top: 4.75rem; }
  .mobile-brand { font: 600 1rem/1 var(--heading); }
  .document-inner { padding: 2.5rem 1.35rem 4rem; }
  .atlas-regions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@container report (min-width: 120ch) {
  .prose-flow {
    max-width: none;
    column-count: 2;
    column-gap: clamp(2.75rem, 4.25cqi, 4.75rem);
    column-rule: 1px solid var(--rule);
  }
}

@container report (min-width: 190ch) {
  .prose-flow { column-count: 3; }
}

@container report (min-width: 165ch) {
  .coverage-subsystem-list { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@container report (max-width: 92ch) {
  .coverage-subsystem-list { grid-template-columns: minmax(0, 1fr); }
}

@container report (max-width: 52ch) {
  .record-finding .record-meta { grid-template-columns: minmax(0, 1fr); }
  .record-concern-checklist .record-meta { grid-template-columns: minmax(0, 1fr); }
  .record-concern-checklist .record-facts > div { justify-content: flex-start; }
}

@media (max-width: 620px) {
  h1 { font-size: clamp(2.4rem, 12vw, 3.35rem); }
  .runtime-detail { grid-template-columns: 1fr; }
  .runtime-detail-head { border-right: 0; border-bottom: 1px solid var(--rule); }
  .runtime-detail-body { grid-template-columns: 1fr; }
  .runtime-detail-body p { border-right: 0; border-bottom: 1px solid var(--rule); }
  .runtime-detail-body p:nth-child(2) { border-bottom: 0; }
  .runtime-detail-body .runtime-detail-note { grid-column: auto; border-bottom: 0; }
  .relationship { grid-template-columns: 1fr; padding-bottom: .75rem; border-bottom: 1px solid var(--rule); }
  .relationship-edge { text-align: left; }
  .relationship-edge b { display: inline; margin-right: .4rem; }
  .bar-row { grid-template-columns: 7rem 1fr 2.5rem; }
  .heading-anchor { display: none; }
  .record { grid-template-columns: 1fr; }
  .record-meta { border-right: 0; border-bottom: 1px solid var(--rule); }
  .record-concern-disposition .record-meta { grid-template-columns: 1fr; }
  .record-fields { grid-template-columns: 1fr; }
  .record-field { border-right: 0; border-bottom: 1px solid var(--rule); }
  .record-field:last-child { border-bottom: 0; }
  .summary-list > div { grid-template-columns: 1fr; }
  .summary-list dd { padding-top: 0; border-left: 0; }
  .atlas-regions { grid-template-columns: 1fr; }
  .topology-component { grid-template-columns: 1fr; }
  .topology-hub { border-right: 0; border-bottom: 1px solid var(--rule); }
  .topology-cross-edge { grid-template-columns: 1fr; }
  .topology-cross-edge .topology-node:last-child { text-align: left; }
  .topology-cross-relation { text-align: left; }
  .coverage-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .coverage-summary-item:nth-child(2) { border-right: 0; }
  .coverage-summary-item:nth-child(-n + 2) { border-bottom: 1px solid var(--rule); }
  .coverage-subsystem { grid-template-columns: 1fr; }
  .coverage-tokens { grid-column: auto; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
}

@media print {
  :root { --canvas: #fff; --surface: #fff; --text: #171b19; --text-muted: #4c5551; --rule: #c7ccc9; }
  .nav-rail, .mobile-bar, .heading-anchor { display: none !important; }
  .document { margin: 0; }
  .document-inner { width: auto; padding: 0; }
  .runtime-svg-scroll { overflow: visible; }
  .runtime-boundary-svg { min-width: 0; }
  .boundary-svg-scroll { overflow: visible; }
  .boundary-svg { width: 100%; }
  .content section, .figure, .runtime-boundary-projection, .table-wrap, .record { break-inside: avoid-page; }
  a { color: inherit; text-decoration: none; }
}
"""

_JS = r"""
(() => {
  const root = document.documentElement;
  const body = document.body;
  const themeButton = document.querySelector('[data-theme-toggle]');
  const themeStorageKey = 'amanuensis-theme';
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  let storedTheme = null;
  try { storedTheme = localStorage.getItem(themeStorageKey); } catch (_) {}
  if (storedTheme === 'light' || storedTheme === 'dark') root.dataset.theme = storedTheme;

  const updateThemeLabel = () => {
    if (!themeButton) return;
    const dark = root.dataset.theme === 'dark' || (!root.dataset.theme && systemTheme.matches);
    themeButton.textContent = dark ? 'Light theme' : 'Dark theme';
    themeButton.setAttribute('aria-label', dark ? 'Use light theme' : 'Use dark theme');
  };
  const applyTheme = (theme) => {
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    else delete root.dataset.theme;
    updateThemeLabel();
  };
  updateThemeLabel();
  themeButton?.addEventListener('click', () => {
    const dark = root.dataset.theme === 'dark' || (!root.dataset.theme && systemTheme.matches);
    const theme = dark ? 'light' : 'dark';
    applyTheme(theme);
    try { localStorage.setItem(themeStorageKey, theme); } catch (_) {}
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== themeStorageKey) return;
    applyTheme(event.newValue);
  });
  systemTheme.addEventListener?.('change', updateThemeLabel);

  const menuButton = document.querySelector('[data-nav-toggle]');
  const navRail = document.querySelector('.nav-rail');
  const documentInner = document.querySelector('.document-inner');
  const narrow = matchMedia('(max-width: 900px)');
  const setMenuOpen = (open, restoreFocus = false) => {
    const effectiveOpen = Boolean(open && narrow.matches);
    body.classList.toggle('nav-open', effectiveOpen);
    menuButton?.setAttribute('aria-expanded', String(effectiveOpen));
    if (navRail) navRail.inert = narrow.matches && !effectiveOpen;
    if (documentInner) documentInner.inert = effectiveOpen;
    if (effectiveOpen) navRail?.querySelector('a, input, button')?.focus();
    else if (restoreFocus) menuButton?.focus();
  };
  setMenuOpen(false);
  menuButton?.addEventListener('click', () => setMenuOpen(!body.classList.contains('nav-open')));
  navRail?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenuOpen(false)));
  narrow.addEventListener?.('change', () => setMenuOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && body.classList.contains('nav-open')) setMenuOpen(false, true);
  });

  // ---------------------------------------------------------------------
  // Search over pages, ledger paths, and cited symbols (spec §8.1.1).
  // The combobox is built here rather than served: an input announced as a
  // combobox that no script can expand promises a control the reader does not
  // have. Without script the rail still lists every page, and every result's
  // target is reachable from it.
  // ---------------------------------------------------------------------
  const search = document.querySelector('[data-nav-search]');
  const searchStatus = document.querySelector('[data-search-status]');
  const locus = (window.__amanuensisLocusIndex && typeof window.__amanuensisLocusIndex === 'object')
    ? window.__amanuensisLocusIndex : {};
  const locusPaths = Array.isArray(locus.paths) ? locus.paths : [];
  const locusSymbols = Array.isArray(locus.symbols) ? locus.symbols : [];
  const RESULT_LIMIT = 24;
  let listbox = null;
  let options = [];
  let activeIndex = -1;
  let priorFocus = null;

  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!target || target === search || target === document.body) return;
    if (listbox && listbox.contains(target)) return;
    priorFocus = target;
  });

  if (search && searchStatus) {
    listbox = document.createElement('ul');
    listbox.id = 'conspectus-search-results';
    listbox.className = 'search-results';
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('aria-label', 'Search results');
    searchStatus.insertAdjacentElement('afterend', listbox);
    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-expanded', 'false');
    search.setAttribute('aria-controls', listbox.id);
    search.setAttribute('aria-activedescendant', '');
    search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-haspopup', 'listbox');
  }

  const rootPrefix = body.dataset.root || '';
  const entries = [];
  document.querySelectorAll('.nav-item').forEach((item) => {
    const link = item.querySelector('a');
    if (!link) return;
    const name = item.querySelector('.nav-name');
    entries.push({
      kind: 'Page',
      label: name ? name.textContent.trim() : link.textContent.trim(),
      detail: '',
      haystack: (item.dataset.search || '').toLocaleLowerCase(),
      href: link.getAttribute('href') || ''
    });
  });
  locusPaths.forEach((item) => {
    if (!item || typeof item.p !== 'string') return;
    const owners = Array.isArray(item.o) ? item.o.join(', ') : '';
    entries.push({
      kind: 'File',
      label: item.p,
      detail: [owners, item.s || ''].filter(Boolean).join(' · '),
      haystack: (item.p + ' ' + owners + ' ' + (item.s || '')).toLocaleLowerCase(),
      href: rootPrefix + (item.h || '')
    });
  });
  locusSymbols.forEach((item) => {
    if (!item || typeof item.y !== 'string') return;
    entries.push({
      kind: 'Symbol',
      label: item.y,
      detail: item.p || '',
      haystack: (item.y + ' ' + (item.p || '')).toLocaleLowerCase(),
      href: rootPrefix + (item.h || '')
    });
  });

  const closeList = (restoreFocus) => {
    if (!listbox) return;
    listbox.textContent = '';
    options = [];
    activeIndex = -1;
    search.setAttribute('aria-expanded', 'false');
    search.setAttribute('aria-activedescendant', '');
    searchStatus.textContent = '';
    if (!restoreFocus) return;
    if (priorFocus && priorFocus.isConnected && typeof priorFocus.focus === 'function') priorFocus.focus();
    else search.blur();
  };

  const setActive = (index) => {
    if (!options.length) return;
    const next = ((index % options.length) + options.length) % options.length;
    options.forEach((option, position) => {
      option.setAttribute('aria-selected', position === next ? 'true' : 'false');
    });
    activeIndex = next;
    search.setAttribute('aria-activedescendant', options[next].id);
    options[next].scrollIntoView({ block: 'nearest' });
  };

  const activate = (index) => {
    const option = options[index];
    if (!option) return;
    const href = option.dataset.href || '';
    closeList(false);
    if (!href) return;
    const parts = href.split('#');
    const fragment = parts.length > 1 ? parts[1] : '';
    const here = location.pathname.split('/').pop();
    const target = parts[0] ? parts[0].split('/').pop() : here;
    if (fragment && target === here) {
      const node = document.getElementById(fragment);
      if (node) {
        if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
        location.hash = '#' + fragment;
        node.focus();
        return;
      }
    }
    location.href = href;
  };

  const renderResults = () => {
    if (!listbox) return;
    listbox.textContent = '';
    options = [];
    activeIndex = -1;
    search.setAttribute('aria-activedescendant', '');
    const needle = search.value.trim().toLocaleLowerCase();
    if (!needle) {
      search.setAttribute('aria-expanded', 'false');
      searchStatus.textContent = '';
      return;
    }
    const matches = entries.filter((entry) => entry.haystack.indexOf(needle) !== -1);
    matches.slice(0, RESULT_LIMIT).forEach((entry, position) => {
      const option = document.createElement('li');
      option.id = 'conspectus-search-option-' + position;
      option.className = 'search-option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.dataset.href = entry.href;
      const kind = document.createElement('span');
      kind.className = 'search-option-kind';
      kind.textContent = entry.kind;
      const label = document.createElement('span');
      label.className = 'search-option-label';
      label.textContent = entry.label;
      option.append(kind, label);
      if (entry.detail) {
        const detail = document.createElement('span');
        detail.className = 'search-option-detail';
        detail.textContent = entry.detail;
        option.append(detail);
      }
      option.addEventListener('click', () => activate(position));
      listbox.append(option);
      options.push(option);
    });
    search.setAttribute('aria-expanded', options.length ? 'true' : 'false');
    if (!matches.length) searchStatus.textContent = 'No match in this projection.';
    else if (matches.length > options.length) {
      searchStatus.textContent = matches.length + ' matches, first ' + options.length + ' listed';
    } else searchStatus.textContent = matches.length + (matches.length === 1 ? ' match' : ' matches');
  };

  search?.addEventListener('input', renderResults);
  search?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!options.length) renderResults();
      setActive(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!options.length) renderResults();
      setActive(activeIndex < 0 ? options.length - 1 : activeIndex - 1);
    } else if (event.key === 'Enter') {
      if (!options.length) return;
      event.preventDefault();
      activate(activeIndex < 0 ? 0 : activeIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeList(true);
    }
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault(); search?.focus(); search?.select();
    }
  });

  // ---------------------------------------------------------------------
  // In-page filters (spec §8.1.2). Native controls in a labelled fieldset,
  // built from the facets the projection stamped on the page; filtering is
  // toggling `hidden` on the rows and on the containers and headings a fully
  // hidden run leaves behind. Nothing is persisted: the state lives in the DOM
  // for the life of the page.
  // ---------------------------------------------------------------------
  const filterScope = document.querySelector('[data-filter-scope]');
  const filterRows = filterScope ? Array.from(filterScope.querySelectorAll('[data-filter-row]')) : [];
  const splitFacet = (value) => (value || '').split('|').map((part) => part.trim()).filter(Boolean);
  if (filterScope && filterRows.length) {
    const scopeName = filterScope.dataset.filterScope || 'page';
    const facets = [
      { key: 'subsystem', prop: 'filterSubsystem', label: 'Subsystem', control: 'select', values: splitFacet(filterScope.dataset.facetSubsystem) },
      { key: 'severity', prop: 'filterSeverity', label: 'Severity', control: 'checkbox', values: splitFacet(filterScope.dataset.facetSeverity) }
    ].filter((facet) => facet.values.length > 1);
    if (facets.length) {
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'filter-controls';
      fieldset.setAttribute('data-filter-controls', '');
      const legend = document.createElement('legend');
      legend.textContent = 'Narrow this page';
      fieldset.append(legend);
      const status = document.createElement('p');
      status.className = 'filter-status';
      status.setAttribute('data-filter-status', '');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      const controls = [];

      const rowValues = (row, prop) => splitFacet(row.dataset[prop]);
      const keeps = (row) => controls.every((control) => {
        const values = rowValues(row, control.prop);
        if (control.select) {
          const wanted = control.select.value;
          return !wanted || values.indexOf(wanted) !== -1;
        }
        // A row that records no value on this facet cannot be excluded by it.
        if (!values.length) return true;
        const wanted = control.boxes.filter((box) => box.checked).map((box) => box.value);
        return values.some((value) => wanted.indexOf(value) !== -1);
      });
      const prune = () => {
        filterScope.querySelectorAll('.record-list, .table-wrap').forEach((group) => {
          if (!group.querySelector('[data-filter-row]')) return;
          group.hidden = !group.querySelector('[data-filter-row]:not([hidden])');
        });
        filterScope.querySelectorAll('h2, h3, h4, h5, h6').forEach((heading) => {
          const level = Number(heading.tagName.slice(1));
          let node = heading.nextElementSibling;
          let total = 0;
          let visible = 0;
          while (node) {
            const tag = node.tagName;
            if (/^H[1-6]$/.test(tag) && Number(tag.slice(1)) <= level) break;
            const rows = node.matches('[data-filter-row]')
              ? [node]
              : Array.from(node.querySelectorAll('[data-filter-row]'));
            total += rows.length;
            visible += rows.filter((row) => !row.hidden).length;
            node = node.nextElementSibling;
          }
          if (total) heading.hidden = visible === 0;
        });
      };
      const apply = () => {
        let shown = 0;
        filterRows.forEach((row) => {
          const keep = keeps(row);
          row.hidden = !keep;
          if (keep) shown += 1;
        });
        prune();
        status.textContent = shown + ' of ' + filterRows.length + ' rows shown';
      };

      facets.forEach((facet) => {
        const wrap = document.createElement('div');
        wrap.className = 'filter-facet';
        if (facet.control === 'select') {
          const id = 'filter-' + scopeName + '-' + facet.key;
          const label = document.createElement('label');
          label.className = 'filter-label';
          label.setAttribute('for', id);
          label.textContent = facet.label;
          const select = document.createElement('select');
          select.id = id;
          select.className = 'filter-select';
          const every = document.createElement('option');
          every.value = '';
          every.textContent = 'Every ' + facet.label.toLocaleLowerCase();
          select.append(every);
          facet.values.forEach((value) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            select.append(option);
          });
          select.addEventListener('change', apply);
          wrap.append(label, select);
          controls.push({ prop: facet.prop, select: select });
        } else {
          const captionId = 'filter-' + scopeName + '-' + facet.key + '-label';
          const caption = document.createElement('span');
          caption.className = 'filter-label';
          caption.id = captionId;
          caption.textContent = facet.label;
          const group = document.createElement('div');
          group.className = 'filter-options';
          group.setAttribute('role', 'group');
          group.setAttribute('aria-labelledby', captionId);
          const boxes = [];
          facet.values.forEach((value, position) => {
            const id = 'filter-' + scopeName + '-' + facet.key + '-' + position;
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.id = id;
            box.value = value;
            box.checked = true;
            box.addEventListener('change', apply);
            const label = document.createElement('label');
            label.setAttribute('for', id);
            label.textContent = value;
            const pair = document.createElement('span');
            pair.className = 'filter-option';
            pair.append(box, label);
            group.append(pair);
            boxes.push(box);
          });
          wrap.append(caption, group);
          controls.push({ prop: facet.prop, boxes: boxes });
        }
        fieldset.append(wrap);
      });
      fieldset.append(status);
      filterScope.prepend(fieldset);
      apply();
    }
  }
})();
"""


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


def _inline_html(node: Inline) -> str:
    if isinstance(node, Text):
        return html.escape(node.text, quote=False)
    if isinstance(node, CodeSpan):
        return f"<code>{html.escape(node.text)}</code>"
    if isinstance(node, Chip):
        return _chip_html(node)
    if isinstance(node, Strong):
        return f"<strong>{''.join(_inline_html(child) for child in node.children)}</strong>"
    if isinstance(node, Emph):
        return f"<em>{''.join(_inline_html(child) for child in node.children)}</em>"
    if isinstance(node, Link):
        attrs = ' rel="noreferrer"' if node.external else ""
        # A label's own words are escaped as the start tree's link printer escaped them.
        label = "".join(
            html.escape(child.text) if isinstance(child, Text) else _inline_html(child)
            for child in node.children or (Text(node.label),)
        )
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
    ) -> None:
        self.route_map = route_map
        self.current_html_path = current_html_path
        self.repository_url = repository_url.rstrip("/") if repository_url else None
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

    def _github_file_url(self, path: str, revision: str) -> str | None:
        parts = PurePosixPath(path).parts
        if (
            not self.repository_url
            or not re.fullmatch(r"https://github\.com/[^/]+/[^/]+", self.repository_url)
            or not re.fullmatch(r"[0-9a-fA-F]{7,40}", revision)
            or not parts
            or path.startswith("/")
            or ".." in parts
        ):
            return None
        return f"{self.repository_url}/blob/{revision}/{quote(path, safe='/')}"

    def _record_list(self, block: RecordList) -> str:
        kind = block.kind
        rendered: list[str] = []
        for record in block.records:
            heading_id = self._unique_slug(record.slug_text)
            if kind == "file-ledger":
                path = record.key_text
                basename = posixpath.basename(path) or path
                file_url = self._github_file_url(record.path, record.revision)
                filename = f"<code>{html.escape(basename)}</code>"
                primary = (
                    f'<a class="file-source-link" href="{html.escape(file_url, quote=True)}" '
                    f'rel="noreferrer" title="Open {html.escape(path, quote=True)} at the reviewed revision on GitHub">{filename}</a>'
                    if file_url
                    else filename
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
        for row in block.rows:
            sid = row.subsystem_id
            if sid not in names:
                names[sid] = row.name
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
            return f"<p>{_inlines_html(block.text)}</p>"
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
) -> str:
    """Print a page model's body as HTML (§3.1). It reads no Markdown."""

    return _HtmlWriter(route_map or {}, page.path, repository_url).write(page)


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
    if page.kind == "subsystem":
        record = html.escape(page.record_id or "record")
        return f'Subsystem · <span data-identifier-defined>{record}</span>'
    if page.kind == "matrix":
        record = html.escape(page.record_id or "matrix")
        return f'Competing explanations · <span data-identifier-defined>{record}</span>'
    return html.escape(page.group)


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
    use_when_para = (
        f'<p class="page-use-when">{html.escape("Use it when " + page.use_when)}</p>'
        if page.use_when
        else ""
    )
    guide_href = _rel_link(page.html_path, GUIDE_PAGE)
    terms_para = (
        f'<p class="page-terms">{html.escape(TERMS_LABEL)} '
        + " · ".join(
            f'<a href="{html.escape(guide_href + "#term-" + slug, quote=True)}">{html.escape(term)}</a>'
            for term, slug in page.terms
        )
        + "</p>"
        if page.terms
        else ""
    )
    notice_para = (
        f'<p class="page-notice" role="note">{html.escape(notice)}</p>' if notice else ""
    )
    home_link = _rel_link(page.html_path, "index.html")
    record_status = _status_html(page.status) if page.status else ""
    status_meta = f'<span class="snapshot-item">Survey depth&nbsp; {record_status}</span>' if record_status else ""
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
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Amanuensis HTML projection {HTML_PROJECTION_VERSION}">
<meta name="description" content="{html.escape(page.hint or display_title, quote=True)}">
<title>{html.escape(display_title)} · {html.escape(project_name)} · Amanuensis</title>
<script>document.documentElement.classList.add('js');try{{const t=localStorage.getItem('amanuensis-theme');if(t)document.documentElement.dataset.theme=t}}catch(e){{}}</script>
<style>{_CSS}</style>
</head>
<body data-root="{html.escape(root_prefix, quote=True)}">
<a class="skip-link" href="#content">Skip to content</a>
<div class="shell">
  <aside class="nav-rail" aria-label="{html.escape(project_name, quote=True)} report navigation">
    <a class="brand" href="{html.escape(home_link, quote=True)}">
      <span class="brand-mark">{html.escape(project_name)}</span>
      <span class="brand-sub">Architecture survey · Amanuensis</span>
    </a>
    <label class="search-label" for="conspectus-search">Find a page, file, or symbol <span aria-hidden="true">⌘K</span></label>
    <input id="conspectus-search" class="nav-search" data-nav-search type="search" placeholder="Page, path, or symbol…" autocomplete="off">
    <p class="search-status" data-search-status role="status" aria-live="polite"></p>
    <nav class="rail-nav">{nav}</nav>
    <div class="rail-foot">
      <div class="rail-actions"><button class="quiet-button" type="button" data-theme-toggle>Theme</button></div>
    </div>
  </aside>
  <main class="document" id="content">
    <div class="mobile-bar"><span class="mobile-brand">{html.escape(project_name)}</span><button class="quiet-button" type="button" data-nav-toggle aria-expanded="false">Browse</button></div>
    <div class="document-inner">
      <header class="page-head">
        <p class="eyebrow">{eyebrow}</p>
        <h1>{html.escape(display_title)}</h1>
        {hint_para}
        {use_when_para}
        {terms_para}
        {notice_para}
        <div class="snapshot-strip">
          <span class="snapshot-item"><b>Branch</b>&nbsp; {html.escape(canonical)}</span>
          <span class="snapshot-item"><b>Checked</b>&nbsp; {html.escape(checked[:12] or 'not recorded')}</span>
          <span class="snapshot-item"><b>As of</b>&nbsp; {html.escape(checked_at)}</span>
          <span class="snapshot-item"><span class="{freshness_class}">{html.escape(freshness_label)}</span></span>
          {status_meta}
        </div>
      </header>
      <article class="content content-{html.escape(slugify(page.kind), quote=True)}"{filter_attrs}>{body}</article>
    </div>
  </main>
</div>
<script src="{html.escape(index_href, quote=True)}"></script>
<script>{_JS}</script>
</body>
</html>
'''


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

    readme_target = output / README_PATH
    files[README_PATH] = sha256_bytes(README_TEXT.encode("utf-8"))
    if not readme_target.is_file() or readme_target.read_text() != README_TEXT:
        readme_target.write_text(README_TEXT)

    for page in pages:
        model = models.get(page.path)
        if model is None:
            warnings.append(f"HTML source missing for {page.path}")
            continue
        body = write_html(
            model,
            route_map,
            repository_url=str(context.get("repository_url") or "") or None,
        )
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
