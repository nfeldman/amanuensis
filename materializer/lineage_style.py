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

The prose-template change of 2026-11-25 (owner ruling) renamed pages, dropped
the hint under every title but a subsystem page's, took the "What it shows"
column out of the reader's guide's page index, and shortened the overview's
opening sentence; the survey note lost its opening caveat. The same change
filled the record cards: a concern prints its territory and what to check, a
finding and a concern review where their attached evidence points, an empty
"Discovered in" or Condition is left out, and a concern code heading its own
record is no longer prefixed "concern". Inside an article that shows as link text, captions and table text
naming a page, the overview's first paragraph, and the index's middle column.
`_retitle` maps those on both sides: the two lens pages the corpus keeps from
SO13 still print the old names, and the orientation gates (O2, O4, O7, O9 and
the guide's) hold the current pages to the new ones.

So the lineage gates compare article bodies, with those changes carried to the
start side and the marks taken off the current side. Everything outside the
article (the shell, the stylesheet and the script) is held byte for byte by the
golden corpus and by test-materializer.py instead. A lineage file under
`assets/` is the style lane's and has no start-side counterpart, and neither has
the overview since it became two parts, About this survey, or the reader's guide
that indexes them (`is_uncompared`).
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


# Old page name -> new, as printed inside an article (link text, a table cell).
_RENAMED = (
    ("How to read this survey", "Reader&#x27;s guide"),
    ("Subsystem map", "Subsystems"),
    ("System boundaries", "Boundaries"),
    ("Codebase glossary", "Glossary"),
    ("Sessions and publications", "Sessions"),
    ("Conflicting evidence", "Settled conflicts"),
    ("Where to begin", "First reading path"),
    ("Calibrated review checklist", "Review checklist"),
)
# The staleness map's exempt-file counts moved to About this survey (owner, 2026-11-26).
_EXEMPT_COUNT_LINK = (
    'counted on the <a href="index.html">overview</a> and are not recorded here',
    'counted on <a href="about.html">About this survey</a> and are not recorded here',
)
_ATLAS_LABEL = ('aria-label="Subsystem map"', 'aria-label="Subsystems"')
_OLD_IDENTITY = re.compile(
    r"An AI agent running Amanuensis read the repository, without changing it, and recorded what it"
    r" found here\. New to this site\? Start with (<a\b[^>]*>)"
)
_SURVEY_NOTE_CAVEAT = "<p><em>A note the survey left on the subsystem record; not bound to a revision.</em></p>\n"
_CARD_ADDITIONS = re.compile(
    r'<div class="record-field"><p class="record-label">(?:Evidence at|What to check)</p>'
    r'<div class="record-copy">.*?</div></div>'
    r'|<div class="record-fact record-fact-territory"><dt>Territory</dt><dd>.*?</dd></div>',
    re.S,
)
_EMPTY_FACT = re.compile(r'<div class="record-fact record-fact-(?:discovered-in|category)"><dt>[^<]*</dt><dd>—</dd></div>')
_TABLE = re.compile(r"<table\b.*?</table>", re.S)
_CONDITION_CELL = re.compile(r'<td data-label="Condition">(.*?)</td>', re.S)
_CONCERN_HEADING = re.compile(r'(<h3 class="record-primary"[^>]*>(?:<span[^>]*></span>)?<strong>(?:<a [^>]*>)?)concern (?=<abbr)')
_SHOWS_HEADER = re.compile(r'<th scope="col">What it shows</th>')
_SHOWS_CELL = re.compile(r'<td data-label="What it shows">.*?</td>', re.S)


# The provenance line's earlier, italic and longer forms (owner, 2026-11-26).
_OLD_PROVENANCE = re.compile(
    r"<p><em>(?:Written by a survey session at (?P<sha>(?:<code>)?[0-9a-f]+(?:</code>)?)"
    r"|Recorded on (?P<date>[^<]*?) at revision (?P<nsha>(?:<code>)?[0-9a-f]+(?:</code>)?))"
    r"(?: from \d+ evidence row\(s\))?\. (?P<ageing>.*?)</em></p>",
    re.S,
)
_OLD_CHANGED = re.compile(r"^(\d+) of the (\d+) file\(s\) it cites changed since: ", re.S)


def _provenance(match: re.Match[str]) -> str:
    ageing = match["ageing"].strip()
    if ageing.startswith("None of the ") and ageing.endswith(" has changed since."):
        ageing = ""
    elif ageing == "Whether the files it cites have changed since is not measured here.":
        ageing = "Not checked against later changes."
    else:
        ageing = _OLD_CHANGED.sub(r"\1 of its \2 cited files changed since: ", ageing)
    head = f"Recorded at {match['sha']}." if match["sha"] else f"Recorded {match['date']} at {match['nsha']}."
    return f'<p class="provenance">{head}{" " + ageing if ageing else ""}</p>'


def _without_empty_condition(match: re.Match[str]) -> str:
    """A table whose Condition column is a dash in every row, without the column."""

    table = match.group(0)
    cells = _CONDITION_CELL.findall(table)
    if not cells or any(cell != "—" for cell in cells):
        return table
    return _CONDITION_CELL.sub("", table.replace('<th scope="col">Condition</th>', ""))


def _retitle(body: str) -> str:
    body = _OLD_IDENTITY.sub(
        r"An agent running Amanuensis read the repository without changing it. New to this site? Start with the \1",
        body,
    )
    body = _SHOWS_CELL.sub("", _SHOWS_HEADER.sub("", body))
    body = _TABLE.sub(_without_empty_condition, _EMPTY_FACT.sub("", _CARD_ADDITIONS.sub("", body)))
    body = _CONCERN_HEADING.sub(r"\1", body)
    body = body.replace('"concern-concern-', '"concern-').replace(
        'data-record-label="concern concern ', 'data-record-label="concern '
    ).replace('data-record-label="concern disposition concern ', 'data-record-label="concern disposition ')
    for old, new in _RENAMED:
        body = body.replace(f">{old}</a>", f">{new}</a>").replace(f">{old}</td>", f">{new}</td>").replace(f">{old}</caption>", f">{new}</caption>")
    body = _OLD_PROVENANCE.sub(_provenance, body)
    body = body.replace(_SURVEY_NOTE_CAVEAT, "").replace(*_EXEMPT_COUNT_LINK)
    return body.replace("Sessions and publications lists them.", "Sessions lists them.").replace(*_ATLAS_LABEL)


def is_style_asset(relative: str) -> bool:
    """Whether a published path is one of the style lane's shared files."""

    return relative.startswith("assets/")


#: The two-part overview (owner, 2026-11-26) replaced the overview's article
#: outright and moved its figures to a page no earlier tree printed. Neither has
#: a start-side page to carry the change to, and the reader's guide, whose page
#: index, "What this site is" and terms' "Seen on" lines name both, changed with
#: them. The lineage gates do not compare the three; O3, O6, O9, O14, P3 and the
#: golden corpus hold them.
UNCOMPARED_PAGES = frozenset({"index.html", "about.html", "how-to-read.html"})


def is_uncompared(relative: str) -> bool:
    """Whether a lineage gate leaves a published path out of its comparison."""

    return is_style_asset(relative) or relative in UNCOMPARED_PAGES


def is_uncompared_golden(relative: str) -> bool:
    """The same, for a golden corpus path such as `lens/html/index.html`."""

    _fixture, _sep, page = relative.partition("/html/")
    return page in UNCOMPARED_PAGES


def _article(text: str) -> str:
    match = _ARTICLE.search(text)
    return match.group(0) if match else text


def _both(text: str) -> str:
    return _TONE_CLASS.sub("", _STYLE_ATTR.sub("", text))


def current(text: str) -> str:
    """The current tree's page, as the lineage gates compare it."""

    if not text.lstrip().startswith("<!doctype html>"):
        return text
    return _both(_retitle(_SOURCE_MARK.sub(lambda m: m.group(2), _article(text))))


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
    return _both(_retitle(body))


def pair(now: str, then: str) -> tuple[str, str]:
    """A current page and an earlier one, as a lineage gate compares them.

    A page the style lane did not reprint (the kept `hooks` fixture, a lens page
    written against a workspace the corpus lacks) is the same on both sides and
    is compared as it is.
    """

    return (now, then) if now == then else (current(now), start(then))
