"""Self-contained HTML projection for the human-facing conspectus.

Markdown remains a useful portable projection, but it is not the primary
reading surface.  This module turns the post-xref Markdown bytes into a
dependency-free HTML site with global navigation, reader hints, semantic
status labels, and local-link integrity.  Every page embeds the same compact
CSS and JavaScript so the projection works from ``file://`` as well as from a
static web server.
"""

from __future__ import annotations

import html
import posixpath
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from .manifest import sha256_bytes
from .slugs import slugify

HTML_PROJECTION_VERSION = "1.0.0"


@dataclass(frozen=True)
class SitePage:
    """Human-facing identity for one Markdown/HTML page pair."""

    markdown_path: str
    title: str
    label: str
    hint: str
    group: str
    kind: str = "reference"
    record_id: str | None = None
    status: str | None = None

    @property
    def html_path(self) -> str:
        return str(Path(self.markdown_path).with_suffix(".html")).replace("\\", "/")


@dataclass
class HtmlProjectionResult:
    files: dict[str, str]
    rendered: int
    unchanged: int
    retired: list[str]
    warnings: list[str]


STATUS_HINTS = {
    "mapped": "Survey complete through structural analysis, concern review, and adversarial challenge.",
    "adversarial": "Candidate conclusions are being challenged; treat them as provisional.",
    "concerns": "Structural mapping is complete and concern-by-concern review is in progress.",
    "structural": "Types, state, flows, and concurrency are mapped; correctness claims are not yet authorized.",
    "scoping": "Only the subsystem boundary and file scope are established so far.",
    "unmapped": "This subsystem has not yet been surveyed; no architectural claims are authorized.",
    "deferred": "This subsystem is intentionally outside the active survey plan.",
    "confirmed-bug": "A defect supported by evidence and retained after adversarial review.",
    "confirmed-acceptable": "The observed behavior is real and judged to be intended or acceptable.",
    "ruled-out": "The candidate problem was overturned by evidence or adversarial review.",
    "out-of-scope": "The concern does not apply within this subsystem's declared boundary.",
    "unresolved-competition": "Multiple explanations remain viable; the evidence does not discriminate.",
    "fixed": "The defect was confirmed at an earlier revision and is recorded as addressed later.",
    "open": "This item still needs attention or a human decision.",
    "resolved": "This item has a recorded resolution.",
    "accepted": "The behavior is recorded as understood and acceptable; it is not an open defect.",
    "fixed-pending-verification": "A repair is recorded, but independent fix evidence has not yet closed the finding.",
    "verified-fixed": "A later revision contains a repair backed by recorded verification evidence.",
}

EVIDENCE_HINTS = {
    "code-verified": "The implementation was read and the stated behavior was verified directly.",
    "contract-stated": "An explicit schema, type, or behavioral contract states this claim.",
    "test-observed": "A test run or recorded observation demonstrates this behavior.",
    "config-asserted": "Configuration states the behavior, but runtime behavior was not independently verified.",
    "doc-asserted": "Project documentation states the claim; implementation agreement is not yet verified.",
    "comment-asserted": "A code comment states the claim; the implementation was not verified against it.",
    "name-inferred": "The claim is inferred from a symbol name and should be treated as weak evidence.",
    "pattern-matched": "The claim matches a known pattern and is only a scoping signal.",
}

SEVERITY_HINTS = {
    "CRITICAL": "Potential data loss, security failure, privilege escalation, or production outage path.",
    "HIGH": "Incorrect behavior on a common path, corrupt state, or a seriously wedged workflow.",
    "MEDIUM": "Incorrect edge-case behavior or a correctness issue with a known workaround.",
    "LOW": "Maintainability, clarity, or defensive-coding risk most likely to affect a future change.",
}

DISPLAY_STATUS = {
    "confirmed-bug": "Confirmed defect",
    "confirmed-acceptable": "Accepted behavior",
    "ruled-out": "Ruled out",
    "out-of-scope": "Out of scope",
    "unresolved-competition": "Competing explanations",
    "code-verified": "Code verified",
    "contract-stated": "Contract stated",
    "test-observed": "Test observed",
    "config-asserted": "Config asserted",
    "doc-asserted": "Docs asserted",
    "comment-asserted": "Comment asserted",
    "name-inferred": "Name inferred",
    "pattern-matched": "Pattern matched",
    "fixed-pending-verification": "Fix awaiting verification",
    "verified-fixed": "Verified fixed",
}

_CSS = r"""
:root {
  color-scheme: light dark;
  --paper: #f2f4f1;
  --paper-deep: #e7ebe7;
  --surface: #fbfcf8;
  --ink: #18221f;
  --ink-soft: #52615c;
  --ink-faint: #74817d;
  --rule: #c9d0ca;
  --rule-strong: #9ca9a2;
  --accent: #235b58;
  --accent-strong: #123f3d;
  --accent-soft: #d8e8e4;
  --signal: #9b5b27;
  --signal-soft: #f3e4d3;
  --danger: #9c3d37;
  --danger-soft: #f4dfdc;
  --good: #2e6a4d;
  --good-soft: #dcecdf;
  --quiet: #65736e;
  --quiet-soft: #e4e8e5;
  --display: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
  --body: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --rail: 18.5rem;
  --measure: 72ch;
}

:root[data-theme="dark"] {
  --paper: #151b19;
  --paper-deep: #101513;
  --surface: #1c2421;
  --ink: #e7ece8;
  --ink-soft: #a9b5b0;
  --ink-faint: #84918c;
  --rule: #34413c;
  --rule-strong: #52615b;
  --accent: #79b6ae;
  --accent-strong: #a1d0ca;
  --accent-soft: #233d38;
  --signal: #d5a064;
  --signal-soft: #3b2b1c;
  --danger: #e28a81;
  --danger-soft: #3d2422;
  --good: #83c09c;
  --good-soft: #1f392b;
  --quiet: #9ca9a4;
  --quiet-soft: #29322f;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #151b19; --paper-deep: #101513; --surface: #1c2421;
    --ink: #e7ece8; --ink-soft: #a9b5b0; --ink-faint: #84918c;
    --rule: #34413c; --rule-strong: #52615b;
    --accent: #79b6ae; --accent-strong: #a1d0ca; --accent-soft: #233d38;
    --signal: #d5a064; --signal-soft: #3b2b1c;
    --danger: #e28a81; --danger-soft: #3d2422;
    --good: #83c09c; --good-soft: #1f392b;
    --quiet: #9ca9a4; --quiet-soft: #29322f;
  }
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; background: var(--paper-deep); }
body {
  margin: 0;
  color: var(--ink);
  background: var(--paper);
  font-family: var(--body);
  font-size: 15.5px;
  line-height: 1.62;
  text-rendering: optimizeLegibility;
}
a { color: var(--accent-strong); text-decoration-thickness: .08em; text-underline-offset: .18em; }
a:hover { text-decoration-thickness: .14em; }
a:focus-visible, button:focus-visible, input:focus-visible, summary:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 3px;
}

.skip-link {
  position: fixed; left: 1rem; top: -5rem; z-index: 100;
  padding: .55rem .8rem; background: var(--ink); color: var(--paper);
}
.skip-link:focus { top: 1rem; }
.shell { min-height: 100vh; }
.atlas-rail {
  position: fixed; inset: 0 auto 0 0; width: var(--rail); z-index: 20;
  display: flex; flex-direction: column; overflow-y: auto;
  padding: 2rem 1.35rem 1.5rem;
  background: var(--paper-deep); border-right: 1px solid var(--rule);
}
.brand { display: block; color: var(--ink); text-decoration: none; margin: 0 0 1.6rem; }
.brand-mark {
  display: block; font: 600 1.5rem/1 var(--display); letter-spacing: -.02em;
}
.brand-line {
  display: block; width: 2.8rem; border-top: 3px double var(--accent); margin: .75rem 0 .65rem;
}
.brand-sub { display: block; color: var(--ink-soft); font: .68rem/1.35 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
.search-label { display: block; margin-bottom: .35rem; color: var(--ink-soft); font: .67rem/1.2 var(--mono); letter-spacing: .07em; text-transform: uppercase; }
.nav-search {
  width: 100%; padding: .55rem .65rem; color: var(--ink); background: var(--surface);
  border: 1px solid var(--rule-strong); border-radius: 0; font: .82rem/1.3 var(--body);
}
.nav-search::placeholder { color: var(--ink-faint); }
.rail-nav { margin-top: 1.5rem; }
.nav-group { margin: 0 0 1.35rem; }
.nav-group-title {
  margin: 0 0 .32rem; color: var(--ink-faint);
  font: 600 .64rem/1.3 var(--mono); letter-spacing: .1em; text-transform: uppercase;
}
.nav-list { list-style: none; margin: 0; padding: 0; }
.nav-item { border-top: 1px solid color-mix(in srgb, var(--rule) 72%, transparent); }
.nav-item:last-child { border-bottom: 1px solid color-mix(in srgb, var(--rule) 72%, transparent); }
.nav-item[hidden], .nav-group[hidden] { display: none; }
.nav-link { display: grid; grid-template-columns: .55rem 1fr; gap: .48rem; padding: .52rem .15rem; color: var(--ink-soft); text-decoration: none; }
.nav-link:hover { color: var(--ink); background: color-mix(in srgb, var(--surface) 55%, transparent); }
.nav-link[aria-current="page"] { color: var(--accent-strong); }
.nav-link[aria-current="page"] .nav-name { font-weight: 700; }
.nav-tick { width: .34rem; height: .34rem; margin-top: .44rem; border: 1px solid var(--rule-strong); background: transparent; }
.nav-link[aria-current="page"] .nav-tick { border-color: var(--accent); background: var(--accent); }
.nav-tick.status-mapped { background: var(--good); border-color: var(--good); }
.nav-tick.status-adversarial, .nav-tick.status-concerns { background: var(--signal); border-color: var(--signal); }
.nav-tick.status-deferred { background: var(--quiet); border-color: var(--quiet); }
.nav-name { display: block; font-size: .82rem; line-height: 1.3; }
.nav-id { display: block; margin-top: .12rem; color: var(--ink-faint); font: .64rem/1.3 var(--mono); }
.rail-foot { margin-top: auto; padding-top: 1.5rem; }
.rail-actions { display: flex; gap: .5rem; align-items: center; }
.quiet-button {
  border: 1px solid var(--rule); padding: .36rem .5rem; color: var(--ink-soft);
  background: transparent; border-radius: 0; cursor: pointer; font: .68rem/1 var(--mono);
}
.quiet-button:hover { border-color: var(--accent); color: var(--accent-strong); }
.rail-note { margin: .7rem 0 0; color: var(--ink-faint); font: .64rem/1.45 var(--mono); }

.document { margin-left: var(--rail); min-height: 100vh; background: var(--surface); }
.mobile-bar { display: none; }
.document-inner { width: min(100%, 78rem); margin: 0 auto; padding: 4.2rem clamp(2rem, 5vw, 5.8rem) 5rem; }
.page-head { position: relative; padding: 0 0 2.4rem; border-bottom: 3px double var(--ink); }
.page-head::after {
  content: ""; position: absolute; left: -1.2rem; bottom: -3px; width: .35rem; height: 3px; background: var(--accent);
}
.eyebrow { margin: 0 0 .9rem; color: var(--accent); font: 600 .69rem/1.3 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
h1 { max-width: 22ch; margin: 0; font: 600 clamp(2.25rem, 4.2vw, 4.3rem)/1.03 var(--display); letter-spacing: -.035em; text-wrap: balance; }
.page-hint { max-width: 64ch; margin: 1.1rem 0 0; color: var(--ink-soft); font: italic 1.06rem/1.52 var(--display); }
.snapshot-strip { display: flex; flex-wrap: wrap; gap: .6rem 1.4rem; margin-top: 1.5rem; }
.snapshot-item { color: var(--ink-soft); font: .7rem/1.45 var(--mono); }
.snapshot-item b { color: var(--ink); font-weight: 650; }
.freshness { display: inline-flex; gap: .38rem; align-items: center; }
.freshness::before { content: ""; width: .45rem; height: .45rem; background: var(--good); border-radius: 50%; }
.freshness.stale::before { background: var(--signal); }

.reading-note { display: grid; grid-template-columns: 5.5rem minmax(0, var(--measure)); gap: 1rem; padding: 1.15rem 0; border-bottom: 1px solid var(--rule); }
.reading-note-label { color: var(--ink-faint); font: .66rem/1.45 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
.reading-note p { margin: 0; color: var(--ink-soft); font-size: .88rem; }
.content { max-width: 100%; padding-top: .4rem; }
.content section { position: relative; padding: 2.7rem 0; border-bottom: 1px solid var(--rule); }
.content section:last-child { border-bottom: 0; }
.content > p, .content > ul, .content > ol, .content > blockquote { margin-left: 0; }
h2, h3, h4, h5, h6 { position: relative; color: var(--ink); text-wrap: balance; scroll-margin-top: 1.5rem; }
h2 { max-width: 28ch; margin: 0 0 1.15rem; font: 600 1.75rem/1.18 var(--display); letter-spacing: -.015em; }
h3 { max-width: 42ch; margin: 2.1rem 0 .7rem; font: 650 1.05rem/1.3 var(--body); }
h4 { max-width: 52ch; margin: 1.65rem 0 .55rem; color: var(--accent-strong); font: 650 .9rem/1.35 var(--body); }
h5, h6 { margin: 1.4rem 0 .5rem; font-size: .85rem; }
.heading-anchor { position: absolute; left: -1.2rem; color: var(--ink-faint); text-decoration: none; opacity: 0; font-family: var(--mono); }
:is(h2,h3,h4,h5,h6):hover .heading-anchor, .heading-anchor:focus { opacity: 1; }
p { max-width: var(--measure); margin: 0 0 1rem; }
strong { font-weight: 680; }
em { font-family: var(--display); }
code {
  padding: .08rem .25rem; color: var(--accent-strong); background: var(--accent-soft);
  font: .82em/1.4 var(--mono); overflow-wrap: anywhere;
}
ul, ol { max-width: var(--measure); margin: .4rem 0 1.2rem; padding-left: 1.35rem; }
li { padding-left: .25rem; margin: 0 0 .48rem; }
li::marker { color: var(--accent); }
blockquote { max-width: var(--measure); margin: 1.2rem 0; padding: .25rem 0 .25rem 1.2rem; border-left: 3px solid var(--accent); color: var(--ink-soft); }
blockquote p { margin: 0; font: italic 1.02rem/1.58 var(--display); }
.raw-prose-note { border-left-color: var(--signal); }

.table-wrap { width: 100%; margin: 1.1rem 0 1.5rem; overflow-x: auto; border-top: 2px solid var(--ink); border-bottom: 1px solid var(--rule-strong); }
table { width: 100%; border-collapse: collapse; font-size: .86rem; line-height: 1.48; }
caption { padding: .55rem 0; color: var(--ink-faint); text-align: left; font: .65rem/1.3 var(--mono); letter-spacing: .07em; text-transform: uppercase; }
th { padding: .6rem .7rem; color: var(--ink-soft); border-bottom: 1px solid var(--rule-strong); text-align: left; vertical-align: bottom; font: 650 .65rem/1.35 var(--mono); letter-spacing: .06em; text-transform: uppercase; }
td { padding: .7rem; border-bottom: 1px solid var(--rule); text-align: left; vertical-align: top; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: color-mix(in srgb, var(--accent-soft) 35%, transparent); }
td:first-child, th:first-child { padding-left: .15rem; }
.section-current-state .table-wrap { max-width: 54rem; }
.section-current-state table { font-size: .92rem; }
.section-current-state td:last-child { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.section-coverage-heatmap table td:not(:first-child), .section-coverage-heatmap table th:not(:first-child) { text-align: center; }

.status, .evidence-label, .severity {
  display: inline-flex; align-items: center; gap: .38rem; padding: .16rem .46rem;
  border: 1px solid currentColor; white-space: nowrap; font: 650 .68rem/1.3 var(--mono); letter-spacing: .015em;
}
.status::before, .severity::before { content: ""; flex: 0 0 auto; width: .43rem; height: .43rem; border-radius: 50%; background: currentColor; }
.status-mapped, .status-ruled-out, .status-resolved { color: var(--good); background: var(--good-soft); }
.status-adversarial, .status-concerns, .status-structural, .status-scoping, .status-open, .status-unresolved-competition { color: var(--signal); background: var(--signal-soft); }
.status-confirmed-bug, .severity-critical, .severity-high { color: var(--danger); background: var(--danger-soft); }
.status-unmapped, .status-deferred, .status-out-of-scope { color: var(--quiet); background: var(--quiet-soft); }
.status-confirmed-acceptable, .status-fixed, .status-accepted, .status-verified-fixed { color: var(--accent); background: var(--accent-soft); }
.status-fixed-pending-verification { color: var(--signal); background: var(--signal-soft); }
.severity-medium { color: var(--signal); background: var(--signal-soft); }
.severity-low { color: var(--accent); background: var(--accent-soft); }
.evidence-label { color: var(--accent); background: var(--accent-soft); border-style: dotted; }
.evidence-label.weak { color: var(--signal); background: var(--signal-soft); }

.figure { margin: 1.4rem 0 1.7rem; padding: 1rem 0 1.15rem; border-top: 1px solid var(--rule-strong); border-bottom: 1px solid var(--rule-strong); }
.figure-label { margin: 0 0 .9rem; color: var(--ink-faint); font: .65rem/1.35 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
.relationship-map { display: grid; gap: .55rem; }
.relationship { display: grid; grid-template-columns: minmax(8rem, 1fr) 3.5rem minmax(8rem, 1fr); gap: .65rem; align-items: center; }
.relationship-node { display: block; min-width: 0; padding: .65rem .75rem; border-left: 3px solid var(--accent); background: var(--paper); text-decoration: none; }
.relationship-node strong { display: block; color: var(--accent-strong); font: .74rem/1.3 var(--mono); }
.relationship-node span { display: block; margin-top: .16rem; color: var(--ink-soft); font-size: .78rem; overflow-wrap: anywhere; }
.relationship-edge { color: var(--ink-faint); text-align: center; font: .62rem/1.15 var(--mono); }
.relationship-edge b { display: block; color: var(--accent); font-size: 1.1rem; font-weight: 400; }
.bar-chart { display: grid; gap: .6rem; }
.bar-row { display: grid; grid-template-columns: minmax(7rem, 12rem) 1fr 3rem; gap: .7rem; align-items: center; }
.bar-label, .bar-value { font: .7rem/1.3 var(--mono); }
.bar-track { height: .5rem; background: var(--paper-deep); }
.bar-fill { height: 100%; background: var(--accent); }
.diagram-source, pre:not(.diagram-source) { max-width: 100%; overflow-x: auto; margin: 1rem 0; padding: 1rem; border-left: 3px solid var(--rule-strong); background: var(--paper); color: var(--ink); font: .75rem/1.55 var(--mono); white-space: pre-wrap; }

.page-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1rem; margin-top: 2rem; padding-top: 1rem; border-top: 3px double var(--ink); color: var(--ink-faint); font: .65rem/1.5 var(--mono); }
.page-foot p { margin: 0; max-width: 52rem; }
.page-foot a { color: inherit; }
.empty-search { display: none; margin: 1rem 0; color: var(--ink-soft); font-size: .8rem; }
.empty-search.visible { display: block; }

@media (max-width: 900px) {
  .atlas-rail { transform: translateX(-102%); transition: transform .18s ease; box-shadow: 0 0 0 999px transparent; }
  body.nav-open .atlas-rail { transform: translateX(0); box-shadow: 0 0 0 999px color-mix(in srgb, var(--ink) 28%, transparent); }
  .document { margin-left: 0; }
  .mobile-bar { position: sticky; top: 0; z-index: 15; display: flex; justify-content: space-between; align-items: center; padding: .7rem 1rem; background: color-mix(in srgb, var(--surface) 92%, transparent); border-bottom: 1px solid var(--rule); backdrop-filter: blur(10px); }
  .mobile-brand { font: 600 1rem/1 var(--display); }
  .document-inner { padding: 2.5rem 1.35rem 4rem; }
}

@media (max-width: 620px) {
  h1 { font-size: 2.45rem; }
  .reading-note { grid-template-columns: 1fr; gap: .35rem; }
  .relationship { grid-template-columns: 1fr; padding-bottom: .75rem; border-bottom: 1px solid var(--rule); }
  .relationship-edge { text-align: left; }
  .relationship-edge b { display: inline; margin-right: .4rem; }
  .bar-row { grid-template-columns: 7rem 1fr 2.5rem; }
  .heading-anchor { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
}

@media print {
  :root { --paper: #fff; --surface: #fff; --ink: #171b19; --ink-soft: #4c5551; --rule: #c7ccc9; }
  .atlas-rail, .mobile-bar, .reading-note, .heading-anchor { display: none !important; }
  .document { margin: 0; }
  .document-inner { width: auto; padding: 0; }
  .content section, .figure, .table-wrap { break-inside: avoid-page; }
  a { color: inherit; text-decoration: none; }
}
"""

_JS = r"""
(() => {
  const root = document.documentElement;
  const themeButton = document.querySelector('[data-theme-toggle]');
  let storedTheme = null;
  try { storedTheme = localStorage.getItem('amanuensis-theme'); } catch (_) {}
  if (storedTheme === 'light' || storedTheme === 'dark') root.dataset.theme = storedTheme;

  const updateThemeLabel = () => {
    if (!themeButton) return;
    const dark = root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    themeButton.textContent = dark ? 'Light page' : 'Dark page';
    themeButton.setAttribute('aria-label', dark ? 'Use light theme' : 'Use dark theme');
  };
  updateThemeLabel();
  themeButton?.addEventListener('click', () => {
    const dark = root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('amanuensis-theme', root.dataset.theme); } catch (_) {}
    updateThemeLabel();
  });

  const menuButton = document.querySelector('[data-nav-toggle]');
  menuButton?.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    menuButton.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') document.body.classList.remove('nav-open');
  });

  const search = document.querySelector('[data-nav-search]');
  const empty = document.querySelector('[data-empty-search]');
  const filter = () => {
    const needle = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    document.querySelectorAll('.nav-item').forEach((item) => {
      const match = !needle || item.dataset.search.includes(needle);
      item.hidden = !match;
      if (match) visible += 1;
    });
    document.querySelectorAll('.nav-group').forEach((group) => {
      group.hidden = !group.querySelector('.nav-item:not([hidden])');
    });
    empty?.classList.toggle('visible', visible === 0);
  };
  search?.addEventListener('input', filter);
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault(); search?.focus(); search?.select();
    }
  });
})();
"""


def _plain(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", text)
    text = text.replace("**", "").replace("__", "").replace("`", "")
    return html.unescape(text).strip()


def _rel_link(from_path: str, to_path: str) -> str:
    base = posixpath.dirname(from_path) or "."
    return posixpath.relpath(to_path, base)


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


def _status_html(value: str, *, severity: bool = False) -> str:
    raw = value.strip()
    key = raw.lower()
    if severity:
        key = raw.upper()
        label = key.title()
        hint = SEVERITY_HINTS.get(key, "Finding impact level.")
        return f'<span class="severity severity-{key.lower()}" title="{html.escape(hint, quote=True)}">{html.escape(label)}</span>'
    hint = STATUS_HINTS.get(key, "Recorded workflow state.")
    label = DISPLAY_STATUS.get(key, key.replace("-", " ").title())
    return f'<span class="status status-{html.escape(key)}" title="{html.escape(hint, quote=True)}">{html.escape(label)}</span>'


def _code_html(value: str) -> str:
    key = value.strip().lower()
    if key in STATUS_HINTS:
        return _status_html(key)
    if key in EVIDENCE_HINTS:
        weak = key in {"comment-asserted", "name-inferred", "pattern-matched"}
        label = DISPLAY_STATUS.get(key, key.replace("-", " ").title())
        cls = "evidence-label weak" if weak else "evidence-label"
        return f'<span class="{cls}" title="{html.escape(EVIDENCE_HINTS[key], quote=True)}">{html.escape(label)}</span>'
    if value == "ACH":
        return '<abbr title="Analysis of Competing Hypotheses">ACH</abbr>'
    return f"<code>{html.escape(value)}</code>"


def _inline(text: str) -> str:
    """Render the deliberately small inline subset emitted by Amanuensis."""

    stripped = text.strip()
    if stripped.lower() in STATUS_HINTS:
        return _status_html(stripped)
    if stripped.upper() in SEVERITY_HINTS:
        return _status_html(stripped, severity=True)

    placeholders: list[str] = []

    def stash(rendered: str) -> str:
        placeholders.append(rendered)
        return f"\x00{len(placeholders) - 1}\x00"

    # Durable projection markers and explicit xref anchors are the only raw
    # HTML accepted.  All record-authored prose is escaped below.
    text = re.sub(
        r"<!--\s*amanuensis:(?:finding|stale-entry):[0-9a-f]+\s*-->",
        lambda m: stash(m.group(0)),
        text,
    )
    text = re.sub(
        r'<a\s+id="([a-zA-Z0-9_.:-]+)"></a>',
        lambda m: stash(f'<span id="{html.escape(m.group(1), quote=True)}" class="record-anchor"></span>'),
        text,
    )
    text = re.sub(r"`([^`]+)`", lambda m: stash(_code_html(m.group(1))), text)

    def link_repl(match: re.Match[str]) -> str:
        label, href = match.group(1), _html_href(match.group(2).strip())
        safe_href = html.escape(href, quote=True)
        safe_label = html.escape(_plain(label))
        external = href.startswith(("http://", "https://"))
        attrs = ' rel="noreferrer"' if external else ""
        return stash(f'<a href="{safe_href}"{attrs}>{safe_label}</a>')

    text = re.sub(r"\[([^]]+)\]\(([^)]+)\)", link_repl, text)

    text = re.sub(
        r"([🟢🟡🟠🔵⚪⚫])\s+(mapped|adversarial|concerns|structural|scoping|unmapped|deferred)",
        lambda m: stash(_status_html(m.group(2))),
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"([🔴🟠🟡🔵])\s+(CRITICAL|HIGH|MEDIUM|LOW)",
        lambda m: stash(_status_html(m.group(2), severity=True)),
        text,
    )

    text = html.escape(text, quote=False)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"__(.+?)__", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\w)_(.+?)_(?!\w)", r"<em>\1</em>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", text)
    text = text.replace("  \n", "<br>\n")
    for i, rendered in enumerate(placeholders):
        text = text.replace(f"\x00{i}\x00", rendered)
    return text


def _split_table_row(line: str) -> list[str]:
    raw = line.strip().strip("|")
    cells = re.split(r"(?<!\\)\|", raw)
    return [cell.strip().replace("\\|", "|") for cell in cells]


def _is_table_separator(line: str) -> bool:
    cells = _split_table_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


class MarkdownRenderer:
    def __init__(self, route_map: dict[str, str], current_html_path: str) -> None:
        self.route_map = route_map
        self.current_html_path = current_html_path
        self.used_slugs: dict[str, int] = {}

    def _heading_slug(self, title: str) -> str:
        base = slugify(_plain(title))
        count = self.used_slugs.get(base, 0)
        self.used_slugs[base] = count + 1
        return base if count == 0 else f"{base}-{count + 1}"

    def _route(self, record_id: str) -> str | None:
        target = self.route_map.get(record_id)
        if not target:
            return None
        return _rel_link(self.current_html_path, target)

    def _node(self, record_id: str, label: str) -> str:
        name = re.sub(r"<br\s*/?>", " ", label, flags=re.IGNORECASE)
        name = html.unescape(name).strip()
        if name.startswith(record_id):
            name = name[len(record_id) :].strip()
        body = f"<strong>{html.escape(record_id)}</strong><span>{html.escape(name or record_id)}</span>"
        href = self._route(record_id)
        if href:
            return f'<a class="relationship-node" href="{html.escape(href, quote=True)}">{body}</a>'
        return f'<span class="relationship-node">{body}</span>'

    def _mermaid(self, source: str) -> str:
        lines = [line.strip() for line in source.splitlines() if line.strip()]
        if lines and lines[0].startswith("graph "):
            nodes: dict[str, tuple[str, str]] = {}
            edges: list[tuple[str, str, str, str]] = []
            for line in lines[1:]:
                node = re.fullmatch(r'(\w+)\["(.+?)"\]', line)
                if node:
                    label = node.group(2)
                    record = re.split(r"<br\s*/?>", label, flags=re.IGNORECASE)[0]
                    nodes[node.group(1)] = (record, label)
                    continue
                edge = re.fullmatch(r'(\w+)\s+(-->|<-->)\|"?(.+?)"?\|\s+(\w+)', line)
                if edge:
                    edges.append((edge.group(1), edge.group(2), edge.group(3), edge.group(4)))
            if edges:
                rendered = []
                for left, arrow, edge_label, right in edges:
                    left_id, left_label = nodes.get(left, (left, left))
                    right_id, right_label = nodes.get(right, (right, right))
                    clean_edge = re.sub(r"<br\s*/?>", " · ", edge_label, flags=re.IGNORECASE).strip('"')
                    glyph = "↔" if arrow == "<-->" else "→"
                    rendered.append(
                        '<div class="relationship">'
                        + self._node(left_id, left_label)
                        + f'<div class="relationship-edge"><b aria-hidden="true">{glyph}</b>{html.escape(clean_edge)}</div>'
                        + self._node(right_id, right_label)
                        + "</div>"
                    )
                return '<figure class="figure"><figcaption class="figure-label">Relationship trace</figcaption><div class="relationship-map">' + "".join(rendered) + "</div></figure>"
        if lines and lines[0] == "pie showData":
            values: list[tuple[str, float]] = []
            for line in lines[1:]:
                match = re.fullmatch(r'"(.+?)"\s*:\s*([0-9.]+)', line)
                if match:
                    values.append((match.group(1), float(match.group(2))))
            if values:
                ceiling = max(value for _, value in values) or 1
                bars = "".join(
                    f'<div class="bar-row"><span class="bar-label">{html.escape(label)}</span><span class="bar-track"><span class="bar-fill" style="width:{value / ceiling * 100:.2f}%"></span></span><span class="bar-value">{value:g}</span></div>'
                    for label, value in values
                )
                return f'<figure class="figure"><figcaption class="figure-label">Staleness distribution</figcaption><div class="bar-chart">{bars}</div></figure>'
        return f'<figure class="figure"><figcaption class="figure-label">Diagram source</figcaption><pre class="diagram-source">{html.escape(source)}</pre></figure>'

    def render(self, markdown: str) -> tuple[str, str]:
        lines = markdown.splitlines()
        title = "Conspectus"
        body: list[str] = []
        i = 0
        in_section = False
        current_section = ""

        while i < len(lines):
            line = lines[i]
            if not line.strip():
                i += 1
                continue

            if line.startswith("<!--") and line.rstrip().endswith("-->"):
                body.append(line)
                i += 1
                continue

            anchor = re.fullmatch(r'<a\s+id="([a-zA-Z0-9_.:-]+)"></a>', line.strip())
            if anchor:
                body.append(f'<span id="{html.escape(anchor.group(1), quote=True)}" class="record-anchor"></span>')
                i += 1
                continue

            fence = re.match(r"^```\s*([\w-]*)\s*$", line)
            if fence:
                language = fence.group(1).lower()
                code_lines: list[str] = []
                i += 1
                while i < len(lines) and not lines[i].startswith("```"):
                    code_lines.append(lines[i])
                    i += 1
                i += 1 if i < len(lines) else 0
                source = "\n".join(code_lines)
                if language == "mermaid":
                    body.append(self._mermaid(source))
                else:
                    lang_class = f' class="language-{html.escape(language, quote=True)}"' if language else ""
                    body.append(f"<pre><code{lang_class}>{html.escape(source)}</code></pre>")
                continue

            heading = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
            if heading:
                level = len(heading.group(1))
                raw = heading.group(2)
                if level == 1:
                    title = _plain(raw)
                    i += 1
                    continue
                if level == 2:
                    if in_section:
                        body.append("</section>")
                    current_section = slugify(_plain(raw))
                    body.append(f'<section class="section-{html.escape(current_section, quote=True)}">')
                    in_section = True
                anchor_id = self._heading_slug(raw)
                label = html.escape(f"Link to {_plain(raw)}", quote=True)
                body.append(f'<h{level} id="{anchor_id}"><a class="heading-anchor" href="#{anchor_id}" aria-label="{label}">§</a>{_inline(raw)}</h{level}>')
                i += 1
                continue

            if line.startswith("|") and i + 1 < len(lines) and _is_table_separator(lines[i + 1]):
                headers = _split_table_row(line)
                i += 2
                rows: list[tuple[list[str], list[str]]] = []
                pending_markers: list[str] = []
                while i < len(lines):
                    if lines[i].startswith("<!--") and lines[i].rstrip().endswith("-->"):
                        pending_markers.append(lines[i])
                        i += 1
                        continue
                    if not lines[i].startswith("|"):
                        break
                    rows.append((_split_table_row(lines[i]), pending_markers))
                    pending_markers = []
                    i += 1
                caption = current_section.replace("-", " ") or "Data"
                head = "".join(f"<th scope=\"col\">{_inline(cell)}</th>" for cell in headers)
                table_rows = []
                for values, markers in rows:
                    values += [""] * max(0, len(headers) - len(values))
                    cells = "".join(
                        f'<td data-label="{html.escape(_plain(headers[n]), quote=True)}">{_inline(value)}</td>'
                        for n, value in enumerate(values[: len(headers)])
                    )
                    table_rows.append("".join(markers) + f"<tr>{cells}</tr>")
                body.append(f'<div class="table-wrap"><table><caption>{html.escape(caption)}</caption><thead><tr>{head}</tr></thead><tbody>{"".join(table_rows)}</tbody></table></div>')
                continue

            list_match = re.match(r"^\s*([-*+] |\d+\. )(.*)$", line)
            if list_match:
                ordered = list_match.group(1)[0].isdigit()
                tag = "ol" if ordered else "ul"
                items: list[str] = []
                while i < len(lines):
                    item = re.match(r"^\s*([-*+] |\d+\. )(.*)$", lines[i])
                    if not item or item.group(1)[0].isdigit() != ordered:
                        break
                    value = item.group(2)
                    i += 1
                    continuation: list[str] = []
                    while i < len(lines) and lines[i].startswith(("  ", "    ")) and not re.match(r"^\s*[-*+] ", lines[i]):
                        continuation.append(lines[i].strip())
                        i += 1
                    if continuation:
                        value += " " + " ".join(continuation)
                    items.append(f"<li>{_inline(value)}</li>")
                body.append(f"<{tag}>{''.join(items)}</{tag}>")
                continue

            if line.startswith(">"):
                quote: list[str] = []
                while i < len(lines) and lines[i].startswith(">"):
                    quote.append(lines[i][1:].lstrip())
                    i += 1
                body.append(f"<blockquote><p>{_inline(' '.join(quote))}</p></blockquote>")
                continue

            paragraph = [line.strip()]
            i += 1
            while i < len(lines) and lines[i].strip():
                candidate = lines[i]
                if re.match(r"^(#{1,6})\s+", candidate) or candidate.startswith(("```", "|", ">", "<!--", '<a id="')) or re.match(r"^\s*([-*+] |\d+\. )", candidate):
                    break
                paragraph.append(candidate.strip())
                i += 1
            body.append(f"<p>{_inline(' '.join(paragraph))}</p>")

        if in_section:
            body.append("</section>")
        return title, "\n".join(body)


def _page_eyebrow(page: SitePage) -> str:
    if page.kind == "subsystem":
        return f"Subsystem · {page.record_id or 'record'}"
    if page.kind == "matrix":
        return f"Competing explanations · {page.record_id or 'matrix'}"
    return page.group


def _nav(pages: list[SitePage], current: SitePage) -> str:
    groups: dict[str, list[SitePage]] = {}
    for page in pages:
        groups.setdefault(page.group, []).append(page)
    chunks: list[str] = []
    for group, items in groups.items():
        lis: list[str] = []
        for page in items:
            href = _rel_link(current.html_path, page.html_path)
            selected = ' aria-current="page"' if page.html_path == current.html_path else ""
            status_class = f" status-{page.status}" if page.status else ""
            record = f'<span class="nav-id">{html.escape(page.record_id)}</span>' if page.record_id else ""
            search = " ".join(filter(None, (page.label, page.record_id, page.hint, page.status))).lower()
            title = html.escape(page.hint, quote=True)
            lis.append(
                f'<li class="nav-item" data-search="{html.escape(search, quote=True)}">'
                f'<a class="nav-link" href="{html.escape(href, quote=True)}" title="{title}"{selected}>'
                f'<span class="nav-tick{status_class}" aria-hidden="true"></span>'
                f'<span><span class="nav-name">{html.escape(page.label)}</span>{record}</span></a></li>'
            )
        chunks.append(
            f'<section class="nav-group"><h2 class="nav-group-title">{html.escape(group)}</h2>'
            f'<ul class="nav-list">{"".join(lis)}</ul></section>'
        )
    return "".join(chunks)


def _shell(
    page: SitePage,
    pages: list[SitePage],
    source_title: str,
    body: str,
    context: dict[str, Any],
) -> str:
    canonical = str(context.get("canonical_branch") or "not recorded")
    checked = str(context.get("last_checked_sha") or "")
    checked_at = str(context.get("last_checked_at") or "not recorded")
    stale_count = int(context.get("stale_entry_count") or 0)
    source_aligned = bool(checked and stale_count == 0)
    freshness_label = "No recorded stale entries" if source_aligned else (
        f"{stale_count} stale record{'s' if stale_count != 1 else ''}" if stale_count else "Source check not recorded"
    )
    freshness_class = "freshness" if source_aligned else "freshness stale"
    display_title = page.title or source_title
    md_link = _rel_link(page.html_path, page.markdown_path)
    home_link = _rel_link(page.html_path, "index.html")
    record_status = _status_html(page.status) if page.status else ""
    status_meta = f'<span class="snapshot-item">Survey depth&nbsp; {record_status}</span>' if record_status else ""
    nav = _nav(pages, page)
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Amanuensis HTML projection {HTML_PROJECTION_VERSION}">
<meta name="description" content="{html.escape(page.hint, quote=True)}">
<title>{html.escape(display_title)} · Amanuensis conspectus</title>
<script>try{{const t=localStorage.getItem('amanuensis-theme');if(t)document.documentElement.dataset.theme=t}}catch(e){{}}</script>
<style>{_CSS}</style>
</head>
<body>
<a class="skip-link" href="#content">Skip to the record</a>
<div class="shell">
  <aside class="atlas-rail" aria-label="Conspectus navigation">
    <a class="brand" href="{html.escape(home_link, quote=True)}">
      <span class="brand-mark">Amanuensis</span><span class="brand-line" aria-hidden="true"></span>
      <span class="brand-sub">Living architecture<br>evidence register</span>
    </a>
    <label class="search-label" for="conspectus-search">Find a page <span aria-hidden="true">⌘K</span></label>
    <input id="conspectus-search" class="nav-search" data-nav-search type="search" placeholder="Name, ID, or topic…" autocomplete="off">
    <p class="empty-search" data-empty-search>No matching page in this projection.</p>
    <nav class="rail-nav">{nav}</nav>
    <div class="rail-foot">
      <div class="rail-actions"><button class="quiet-button" type="button" data-theme-toggle>Theme</button><a class="quiet-button" href="{html.escape(md_link, quote=True)}">Markdown source</a></div>
      <p class="rail-note">A derived reading surface. Durable records remain authoritative.</p>
    </div>
  </aside>
  <main class="document" id="content">
    <div class="mobile-bar"><span class="mobile-brand">Amanuensis</span><button class="quiet-button" type="button" data-nav-toggle aria-expanded="false">Browse</button></div>
    <div class="document-inner">
      <header class="page-head">
        <p class="eyebrow">{html.escape(_page_eyebrow(page))}</p>
        <h1>{html.escape(display_title)}</h1>
        <p class="page-hint">{html.escape(page.hint)}</p>
        <div class="snapshot-strip">
          <span class="snapshot-item"><b>Branch</b>&nbsp; {html.escape(canonical)}</span>
          <span class="snapshot-item"><b>Checked</b>&nbsp; {html.escape(checked[:12] or 'not recorded')}</span>
          <span class="snapshot-item"><b>As of</b>&nbsp; {html.escape(checked_at)}</span>
          <span class="snapshot-item"><span class="{freshness_class}">{html.escape(freshness_label)}</span></span>
          {status_meta}
        </div>
      </header>
      <aside class="reading-note" aria-label="Reading hint"><span class="reading-note-label">Reading hint</span><p>{html.escape(page.hint)}</p></aside>
      <article class="content">{body}</article>
      <footer class="page-foot"><p>This HTML and its Markdown companion are regenerated from the same conspectus state and verified after cross-link resolution.</p><p><a href="{html.escape(md_link, quote=True)}">Inspect Markdown</a></p></footer>
    </div>
  </main>
</div>
<script>{_JS}</script>
</body>
</html>
'''


def render_html_projection(
    output: Path,
    pages: list[SitePage],
    context: dict[str, Any],
    previous_files: dict[str, str] | None = None,
) -> HtmlProjectionResult:
    """Render HTML companions from finished Markdown and retire old HTML."""

    previous_files = previous_files or {}
    route_map = {
        page.record_id: page.html_path
        for page in pages
        if page.record_id
    }
    files: dict[str, str] = {}
    warnings: list[str] = []
    rendered = 0
    unchanged = 0
    for page in pages:
        source = output / page.markdown_path
        if not source.is_file():
            warnings.append(f"HTML source missing for {page.markdown_path}")
            continue
        parser = MarkdownRenderer(route_map, page.html_path)
        source_title, body = parser.render(source.read_text())
        document = _shell(page, pages, source_title, body, context)
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
