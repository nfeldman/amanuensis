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
import textwrap
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

from .manifest import sha256_bytes
from .slugs import slugify

HTML_PROJECTION_VERSION = "1.12.0"


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
    "fixed-pending-verification": "Unverified fix",
    "verified-fixed": "Verified fixed",
}

STATUS_AXIS = {
    **dict.fromkeys(
        ("unmapped", "scoping", "structural", "concerns", "adversarial", "mapped", "deferred"),
        "survey",
    ),
    **dict.fromkeys(
        (
            "confirmed-bug",
            "confirmed-acceptable",
            "ruled-out",
            "out-of-scope",
            "unresolved-competition",
        ),
        "disposition",
    ),
    **dict.fromkeys(
        ("open", "fixed", "resolved", "accepted", "fixed-pending-verification", "verified-fixed"),
        "resolution",
    ),
}

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
.nav-item[hidden], .nav-group[hidden] { display: none; }
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
.page-hint { max-width: none; margin: 1.1rem 0 0; color: var(--text-muted); font: italic clamp(1.05rem, .45vw + .94rem, 1.3rem)/1.48 var(--heading); text-wrap: pretty; }
.snapshot-strip { display: flex; flex-wrap: wrap; gap: .55rem 1.2rem; margin-top: 1.3rem; padding: .7rem .85rem; background: var(--canvas); border: 1px solid var(--rule); border-radius: 0; }
.snapshot-item { color: var(--text-muted); font: .7rem/1.45 var(--mono); }
.snapshot-item b { color: var(--text); font-weight: 650; }
.freshness { display: inline-flex; gap: .38rem; align-items: center; }
.freshness::before { content: ""; width: .45rem; height: .45rem; background: var(--source-aligned); border-radius: 50%; }
.freshness.stale::before { background: var(--source-stale); }

.content { max-width: 100%; padding-top: .35rem; container: report / inline-size; }
.content > section { position: relative; padding: 3rem 0; border-bottom: 1px solid var(--rule); }
.content > section:last-child { border-bottom: 0; }
.content-findings > section { padding: 2.4rem 0 .6rem; border-bottom: 0; }
.content-findings .section-critical-findings { --enum-color: var(--severity-critical); }
.content-findings .section-high-findings { --enum-color: var(--severity-high); }
.content-findings .section-medium-findings { --enum-color: var(--severity-medium); }
.content-findings .section-low-findings { --enum-color: var(--severity-low); }
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
.empty-search { display: none; margin: 1rem 0; color: var(--text-muted); font-size: .8rem; }
.empty-search.visible { display: block; }

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


def _code_html(value: str) -> str:
    key = value.strip().lower()
    if key in STATUS_HINTS:
        return _status_html(key)
    if key in EVIDENCE_HINTS:
        label = DISPLAY_STATUS.get(key, key.replace("-", " ").title())
        cls = f"evidence-label evidence-{key}"
        return f'<span class="{cls}" title="{html.escape(EVIDENCE_HINTS[key], quote=True)}">{html.escape(label)}</span>'
    if value == "ACH":
        return '<abbr title="Analysis of Competing Hypotheses">ACH</abbr>'
    return f"<code>{html.escape(value)}</code>"


def _inline(text: str) -> str:
    """Render the deliberately small inline subset emitted by Amanuensis."""

    stripped = text.strip()
    if stripped.lower() in STATUS_HINTS:
        return _status_html(stripped)
    if stripped.lower() in EVIDENCE_HINTS:
        return _code_html(stripped)
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

    # Retained survey prose may use durable schema vocabulary. Translate it at
    # the human projection boundary without rewriting the Markdown record.
    display_phrases = {
        "concern dispositions": "concern review",
        "evidence dispositions": "concern review",
        "jump-in reading": "start here",
    }
    for source, replacement in display_phrases.items():
        text = re.sub(
            re.escape(source),
            lambda match, value=replacement: value.capitalize()
            if match.group(0)[0].isupper()
            else value,
            text,
            flags=re.IGNORECASE,
        )

    text = html.escape(text, quote=False)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"__(.+?)__", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\w)_(.+?)_(?!\w)", r"<em>\1</em>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", text)
    text = text.replace("  \n", "<br>\n")
    for i in reversed(range(len(placeholders))):
        rendered = placeholders[i]
        text = text.replace(f"\x00{i}\x00", rendered)
    return text


_IDENTIFIER_PATTERN = re.compile(
    r"(?<![\w-])([A-Z]{1,3}\d{0,3}-\d{1,3})(?![\w-])"
)


class _IdentifierMarkup(HTMLParser):
    """Add semantic definitions to known opaque IDs in an HTML fragment."""

    _PROTECTED = frozenset({"abbr", "script", "style"})
    _VOID = frozenset({
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr",
    })

    def __init__(self, definitions: dict[str, str]):
        super().__init__(convert_charrefs=False)
        self.definitions = definitions
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
        if self.protected_depth:
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

        self.parts.append(_IDENTIFIER_PATTERN.sub(replace, data))

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


def _split_table_row(line: str) -> list[str]:
    raw = line.strip().strip("|")
    cells = re.split(r"(?<!\\)\|", raw)
    return [cell.strip().replace("\\|", "|") for cell in cells]


def _is_table_separator(line: str) -> bool:
    cells = _split_table_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


@dataclass(frozen=True)
class RecordProjection:
    """Explicit presentation contract for one known Markdown table schema."""

    kind: str
    key: str
    metadata: tuple[str, ...]
    content: tuple[str, ...]


def _header_key(value: str) -> str:
    return re.sub(r"\s+", " ", _plain(value)).strip().lower()


_RECORD_PROJECTIONS: dict[tuple[str, ...], RecordProjection] = {
    ("id", "status", "symptom", "root cause", "ref sha"): RecordProjection(
        "finding", "id", ("status", "ref sha"), ("symptom", "root cause")
    ),
    ("path", "classification", "why in scope", "ref sha"): RecordProjection(
        "file-ledger", "path", ("classification", "ref sha"), ("why in scope",)
    ),
    ("concern", "classification", "evidence quality", "linchpin?", "rationale"): RecordProjection(
        "concern-disposition",
        "concern",
        ("classification", "evidence quality", "linchpin?"),
        ("rationale",),
    ),
    ("symbol", "role", "source"): RecordProjection(
        "structural-inventory", "symbol", ("source",), ("role",)
    ),
    ("priority", "id", "name", "status", "scope", "jump-in", "findings"): RecordProjection(
        "subsystem",
        "name",
        ("id", "status", "findings", "priority"),
        ("scope", "jump-in"),
    ),
    ("code", "category", "origin", "discovered in", "notes"): RecordProjection(
        "concern", "code", ("category", "origin", "discovered in"), ("notes",)
    ),
    ("code", "category", "discovered in", "notes"): RecordProjection(
        "concern", "code", ("category", "discovered in"), ("notes",)
    ),
    ("territory", "verdict", "derived", "rationale"): RecordProjection(
        "territory", "territory", ("verdict", "derived"), ("rationale",)
    ),
    ("id", "sev", "subsystem", "one-line"): RecordProjection(
        "finding-summary", "id", ("sev", "subsystem"), ("one-line",)
    ),
    ("#", "category", "question", "resolution", "answer"): RecordProjection(
        "open-question", "#", ("category", "resolution"), ("question", "answer")
    ),
    ("seam", "shared object", "kind", "parties", "assessable?", "notes"): RecordProjection(
        "seam", "seam", ("kind", "parties", "assessable?"), ("shared object", "notes")
    ),
}


_SUMMARY_LIST_PROJECTIONS = {
    ("metric", "value"),
    ("status", "what it means"),
    ("status", "what claims are authorized"),
    ("mapping status", "authorized claims"),
    ("quality", "what it means"),
    ("severity", "typical shape"),
    ("task", "start here"),
    ("if you're here because…", "start here"),
    ("prefix", "maps"),
    ("exit", "meaning"),
    ("territory", "attenuating condition"),
}


_LIFECYCLE_TABLE_PROJECTIONS = {
    ("name", "location", "stores", "lifetime", "populated by", "invalidated by"),
    ("name", "location", "what it stores", "lifetime", "populated by", "invalidated by"),
}


_SUBSYSTEM_ATLAS_PROJECTION = ("region", "subsystem", "survey depth")
_DEPENDENCY_TOPOLOGY_PROJECTION = ("from", "relationship", "to", "strength", "context")
_SEAM_TOPOLOGY_PROJECTION = ("seam", "party a", "shared object", "party b")
_RUNTIME_BOUNDARY_PROJECTION = (
    "runtime / process",
    "language",
    "communicates with",
    "mechanism",
    "notes",
)
_CONCERN_CHECKLIST_PROJECTION = (
    "code",
    "category",
    "territory",
    "codebase-specific probe (abbreviated)",
    "primary subsystems",
)

_COVERAGE_STATES = {
    "🔴": ("confirmed-bug", "Confirmed defect", "!"),
    "🟡": ("confirmed-acceptable", "Accepted behavior", "✓"),
    "🟢": ("ruled-out", "Ruled out", "×"),
    "⚪": ("out-of-scope", "Out of scope", "○"),
    "⚠": ("unresolved-competition", "Competing explanations", "?"),
}


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


class MarkdownRenderer:
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
        body = (
            f'<strong data-identifier-defined>{html.escape(record_id)}</strong>'
            f'<span>{html.escape(name or record_id)}</span>'
        )
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

    def _field_label(self, key: str, kind: str) -> str:
        if key == "classification" and kind == "file-ledger":
            return "Review"
        return _DISPLAY_FIELD.get(key, key.replace("-", " ").capitalize())

    def _github_file_url(self, path: str, revision: str) -> str | None:
        clean_path = _plain(path)
        clean_revision = _plain(revision)
        parts = PurePosixPath(clean_path).parts
        if (
            not self.repository_url
            or not re.fullmatch(r"https://github\.com/[^/]+/[^/]+", self.repository_url)
            or not re.fullmatch(r"[0-9a-fA-F]{7,40}", clean_revision)
            or not parts
            or clean_path.startswith("/")
            or ".." in parts
        ):
            return None
        return f"{self.repository_url}/blob/{clean_revision}/{quote(clean_path, safe='/')}"

    def _record_list(
        self,
        headers: list[str],
        rows: list[tuple[list[str], list[str]]],
        caption: str,
        projection: RecordProjection,
    ) -> str:
        keys = [_header_key(header) for header in headers]
        rendered: list[str] = []

        for row_number, (values, markers) in enumerate(rows, start=1):
            record = dict(zip(keys, values, strict=True))
            key_raw = record[projection.key]
            key_text = _plain(key_raw) or f"Record {row_number}"
            heading_id = self._heading_slug(f"{projection.kind}-{key_text}")

            facts: list[tuple[str, str, str]] = []
            if projection.kind == "file-ledger":
                path = key_text
                basename = posixpath.basename(path) or path
                file_url = self._github_file_url(key_raw, record.get("ref sha", ""))
                filename = f"<code>{html.escape(basename)}</code>"
                primary = (
                    f'<a class="file-source-link" href="{html.escape(file_url, quote=True)}" '
                    f'rel="noreferrer" title="Open {html.escape(path, quote=True)} at the reviewed revision on GitHub">{filename}</a>'
                    if file_url
                    else filename
                )
                facts.append(("path", "Path", key_raw))
            elif projection.kind == "open-question":
                primary = f"Question {html.escape(key_text)}"
            elif projection.kind == "subsystem":
                subsystem_id = _plain(record.get("id", ""))
                route = self._route(subsystem_id)
                label = _inline(key_raw)
                primary = (
                    f'<a class="record-primary-link" href="{html.escape(route, quote=True)}">{label}</a>'
                    if route
                    else label
                )
            else:
                primary = _inline(key_raw)

            for key in projection.metadata:
                value = record.get(key, "")
                if not _plain(value):
                    continue
                facts.append((key, self._field_label(key, projection.kind), value))

            fact_chunks: list[str] = []
            for key, label, value in facts:
                value_html = (
                    _status_html(_plain(value), show_hint=False)
                    if projection.kind == "finding" and key == "status"
                    else _inline(value)
                )
                if projection.kind == "subsystem" and key == "id":
                    value_html = f'<span data-identifier-defined>{value_html}</span>'
                fact_chunks.append(
                    f'<div class="record-fact record-fact-{html.escape(slugify(key), quote=True)}">'
                    f'<dt>{html.escape(label)}</dt><dd>{value_html}</dd></div>'
                )
            facts_html = "".join(fact_chunks)
            heading_tag = "h4" if projection.kind == "finding" else "h3"
            definition_context = " data-identifier-defined" if projection.kind == "finding" else ""
            meta = (
                f'<header class="record-meta"{definition_context}>'
                f'<{heading_tag} class="record-primary" id="{html.escape(heading_id, quote=True)}">{primary}</{heading_tag}>'
                + (f'<dl class="record-facts">{facts_html}</dl>' if facts_html else "")
                + "</header>"
            )

            if projection.kind == "finding":
                symptom = record["symptom"]
                parts = re.split(r"(?<=[.!?])\s+", symptom, maxsplit=1)
                lede = f'<p class="record-lede">{_inline(parts[0])}</p>'
                fields: list[str] = []
                if len(parts) == 2 and _plain(parts[1]):
                    fields.append(
                        '<div class="record-field"><p class="record-label">Observed behavior</p>'
                        f'<div class="record-copy">{_inline(parts[1])}</div></div>'
                    )
                fields.append(
                    '<div class="record-field"><p class="record-label">Root cause</p>'
                    f'<div class="record-copy">{_inline(record["root cause"])}</div></div>'
                )
                content = f'<div class="record-body">{lede}<div class="record-fields">{"".join(fields)}</div></div>'
            else:
                fields = []
                for key in projection.content:
                    value = record.get(key, "")
                    if not _plain(value):
                        continue
                    fields.append(
                        f'<div class="record-field"><p class="record-label">{html.escape(self._field_label(key, projection.kind))}</p>'
                        f'<div class="record-copy">{_inline(value)}</div></div>'
                    )
                content = f'<div class="record-fields">{"".join(fields)}</div>'

            aria = html.escape(f"{projection.kind.replace('-', ' ')} {key_text}", quote=True)
            rendered.append(
                "".join(markers)
                + f'<article class="record record-{projection.kind}" role="listitem" aria-labelledby="{html.escape(heading_id, quote=True)}" data-record-label="{aria}">'
                + meta
                + content
                + "</article>"
            )

        label = html.escape(caption, quote=True)
        return f'<div class="record-list record-list-{projection.kind}" role="list" aria-label="{label}">{"".join(rendered)}</div>'

    def _concern_checklist(
        self,
        headers: list[str],
        rows: list[tuple[list[str], list[str]]],
        caption: str,
    ) -> str:
        """Project the calibrated concern table as a grouped reading register."""

        keys = [_header_key(header) for header in headers]
        groups: dict[tuple[str, str], list[tuple[dict[str, str], list[str]]]] = {}
        for values, markers in rows:
            record = dict(zip(keys, values, strict=True))
            group_key = (_plain(record["category"]), _plain(record["territory"]))
            groups.setdefault(group_key, []).append((record, markers))

        rendered_groups: list[str] = []
        for (category, territory), records in groups.items():
            family_name = category.replace("-", " ").capitalize()
            family_id = self._heading_slug(f"{family_name} concerns")
            family_label = f"{family_name} · {territory}" if territory else family_name
            articles: list[str] = []

            for row_number, (record, markers) in enumerate(records, start=1):
                code_raw = record["code"]
                code_text = _plain(code_raw) or f"Concern {row_number}"
                record_id = self._heading_slug(f"concern-checklist-{code_text}")
                primary_subsystems = record.get("primary subsystems", "")
                probe = record.get("codebase-specific probe (abbreviated)", "")
                facts = ""
                if _plain(primary_subsystems):
                    facts = (
                        '<dl class="record-facts"><div class="record-fact record-fact-primary-subsystems">'
                        '<dt>Review in</dt>'
                        f'<dd>{_inline(primary_subsystems)}</dd></div></dl>'
                    )
                articles.append(
                    "".join(markers)
                    + f'<article class="record record-concern-checklist" role="listitem" '
                    f'aria-labelledby="{html.escape(record_id, quote=True)}" '
                    f'data-record-label="{html.escape(f"concern {code_text}", quote=True)}">'
                    '<header class="record-meta">'
                    f'<h4 class="record-primary" id="{html.escape(record_id, quote=True)}">'
                    f'<span data-identifier-defined>{_inline(code_raw)}</span></h4>{facts}</header>'
                    f'<div class="record-body"><div class="record-probe">{_inline(probe)}</div></div>'
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
            f'<div class="concern-checklist" aria-label="{html.escape(caption, quote=True)}">'
            + "".join(rendered_groups)
            + '</div>'
        )

    def _summary_list(
        self,
        rows: list[tuple[list[str], list[str]]],
        caption: str,
    ) -> str:
        items: list[str] = []
        for values, markers in rows:
            key, value = values[:2]
            items.append(
                "".join(markers)
                + f'<div><dt>{_inline(key)}</dt><dd>{_inline(value)}</dd></div>'
            )
        return (
            f'<dl class="summary-list" aria-label="{html.escape(caption, quote=True)}">'
            + "".join(items)
            + "</dl>"
        )

    def _subsystem_atlas(
        self,
        rows: list[tuple[list[str], list[str]]],
        caption: str,
    ) -> str:
        regions: dict[str, list[tuple[str, str, list[str]]]] = {}
        for values, markers in rows:
            region, subsystem, depth = values[:3]
            regions.setdefault(_plain(region) or "Other", []).append((subsystem, depth, markers))

        region_html: list[str] = []
        for region, subsystems in regions.items():
            items = "".join(
                "".join(markers)
                + '<li class="atlas-item">'
                + f'<div class="atlas-subsystem" data-identifier-defined>{_inline(subsystem)}</div>'
                + f'<div class="atlas-depth">{_inline(depth)}</div>'
                + "</li>"
                for subsystem, depth, markers in subsystems
            )
            region_html.append(
                '<section class="atlas-region">'
                '<header class="atlas-region-head">'
                f'<h3>{html.escape(region)}</h3>'
                f'<span class="atlas-region-count">{len(subsystems)} subsystem{"s" if len(subsystems) != 1 else ""}</span>'
                '</header>'
                f'<ul class="atlas-list">{items}</ul>'
                '</section>'
            )

        label = html.escape(caption, quote=True)
        return (
            f'<div class="subsystem-atlas" role="group" aria-label="{label}">'
            '<div class="atlas-summary">'
            f'<strong>{sum(len(items) for items in regions.values())} subsystems</strong>'
            f'<span>{len(regions)} architectural region{"s" if len(regions) != 1 else ""}</span>'
            '<span>Names open the subsystem report</span>'
            '</div>'
            f'<div class="atlas-regions">{"".join(region_html)}</div>'
            '</div>'
        )

    def _runtime_boundary_diagram(
        self,
        rows: list[tuple[list[str], list[str]]],
        caption: str,
    ) -> str:
        """Render recorded runtime relations as inline SVG plus readable HTML."""

        def wrapped(value: str, width: int) -> list[str]:
            plain = _plain(value).strip() or "Not recorded"
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

        for index, (values, markers) in enumerate(rows):
            source, language, target, mechanism, note = values[:5]
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

            svg_rows.append(
                f'<g class="runtime-svg-row">'
                f'<rect class="{lane_class}" x="0" y="{current_y:g}" '
                f'width="{width}" height="{lane_height:g}"/>'
                f'<rect class="runtime-svg-node" x="{source_x}" y="{box_y:g}" '
                f'width="{source_width}" height="{content_height:g}"/>'
                f'<rect class="runtime-svg-node runtime-svg-target" x="{target_x}" y="{box_y:g}" '
                f'width="{target_width}" height="{content_height:g}"/>'
                f'<line class="runtime-svg-edge" x1="{source_x + source_width}" y1="{center_y:g}" '
                f'x2="{target_x}" y2="{center_y:g}"/>'
                f'<path class="runtime-svg-arrow" d="M {target_x:g} {center_y:g} '
                f'L {target_x - 10:g} {center_y - 5:g} L {target_x - 10:g} {center_y + 5:g} Z"/>'
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
                f'{_inline(note)}</p>'
                if _plain(note).strip()
                else ""
            )
            details.append(
                "".join(markers)
                + '<article class="runtime-detail" role="listitem">'
                '<header class="runtime-detail-head">'
                f'<h3>{_inline(source)}</h3>'
                f'<span class="runtime-detail-language">{_inline(language)}</span></header>'
                '<div class="runtime-detail-body">'
                '<p><span class="runtime-detail-label">Communicates with</span>'
                f'{_inline(target)}</p>'
                '<p><span class="runtime-detail-label">Mechanism</span>'
                f'{_inline(mechanism)}</p>{note_html}</div></article>'
            )
            current_y += lane_height

        count = len(rows)
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
        label = html.escape(caption or "runtime boundary map", quote=True)
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
    def _record_identifier(value: str) -> str:
        plain = _plain(value)
        match = re.search(r"\b[A-Za-z][A-Za-z0-9]*-\d+\b", plain)
        return match.group(0) if match else plain

    def _connection_topology(
        self,
        rows: list[tuple[list[str], list[str]]],
        caption: str,
        *,
        kind: str,
    ) -> str:
        edges: list[dict[str, Any]] = []
        nodes: dict[str, str] = {}
        adjacency: dict[str, set[str]] = {}

        for values, markers in rows:
            if kind == "seam":
                key, left, detail, right = values[:4]
                qualifier = ""
                directed = False
            else:
                left, key, right, qualifier, detail = values[:5]
                directed = True
            left_id = self._record_identifier(left)
            right_id = self._record_identifier(right)
            nodes.setdefault(left_id, left)
            nodes.setdefault(right_id, right)
            adjacency.setdefault(left_id, set()).add(right_id)
            adjacency.setdefault(right_id, set()).add(left_id)
            edges.append(
                {
                    "key": key,
                    "left": left_id,
                    "right": right_id,
                    "detail": detail,
                    "qualifier": qualifier,
                    "directed": directed,
                    "markers": markers,
                }
            )

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
                if edge["left"] in component and edge["right"] in component
            ]
            spokes = [edge for edge in component_edges if hub in {edge["left"], edge["right"]}]
            cross_edges = [edge for edge in component_edges if edge not in spokes]

            spoke_html: list[str] = []
            for edge in spokes:
                peer = edge["right"] if edge["left"] == hub else edge["left"]
                if edge["directed"]:
                    outbound = edge["left"] == hub
                    arrow = "→" if outbound else "←"
                    peer_label = "To" if outbound else "From"
                    direction = "Outgoing" if outbound else "Incoming"
                else:
                    arrow = "↔"
                    peer_label = "With"
                    direction = "Two-way seam"
                qualifier = (
                    f'<span class="topology-qualifier">{html.escape(direction)} · {_inline(edge["qualifier"])}</span>'
                    if _plain(edge["qualifier"])
                    else f'<span class="topology-qualifier">{html.escape(direction)}</span>'
                )
                spoke_html.append(
                    "".join(edge["markers"])
                    + '<article class="topology-spoke" role="listitem">'
                    f'<div class="topology-edge-mark" aria-hidden="true">{arrow}</div>'
                    '<div class="topology-edge-body">'
                    '<p class="topology-edge-head">'
                    f'<span class="topology-edge-key">{_inline(edge["key"])}</span>{qualifier}</p>'
                    f'<p class="topology-peer"><span class="topology-peer-label">{peer_label}</span>'
                    f'<span class="topology-node" data-identifier-defined>{_inline(nodes[peer])}</span></p>'
                    f'<p class="topology-object">{_inline(edge["detail"])}</p>'
                    '</div></article>'
                )

            cross_html = ""
            if cross_edges:
                cross_items: list[str] = []
                for edge in cross_edges:
                    arrow = "→" if edge["directed"] else "↔"
                    qualifier = f' · {_inline(edge["qualifier"])}' if _plain(edge["qualifier"]) else ""
                    cross_items.append(
                        "".join(edge["markers"])
                        + '<div class="topology-cross-edge">'
                        f'<span class="topology-node" data-identifier-defined>{_inline(nodes[edge["left"]])}</span>'
                        '<span class="topology-cross-relation">'
                        f'<strong>{_inline(edge["key"])}</strong>{html.escape(arrow)}{qualifier}'
                        f'<span class="topology-cross-object">{_inline(edge["detail"])}</span>'
                        '</span>'
                        f'<span class="topology-node" data-identifier-defined>{_inline(nodes[edge["right"]])}</span>'
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
                f'<h3 class="topology-hub-title" data-identifier-defined>{_inline(nodes[hub])}</h3>'
                f'<p class="topology-hub-count">{len(component)} subsystems · {len(component_edges)} connection{"s" if len(component_edges) != 1 else ""}</p>'
                '</header>'
                f'<div class="topology-spokes" role="list">{"".join(spoke_html)}</div>'
                + cross_html
                + '</section>'
            )

        noun = "seams" if kind == "seam" else "dependencies"
        label = html.escape(caption, quote=True)
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

    def _coverage_index(
        self,
        headers: list[str],
        rows: list[tuple[list[str], list[str]]],
    ) -> str:
        """Sparse, task-oriented projection of the exact coverage matrix."""

        concern_codes = [_plain(header) for header in headers[1:]]
        totals = {state[0]: 0 for state in _COVERAGE_STATES.values()}
        linchpin_total = 0
        records: list[dict[str, Any]] = []

        def outcome(value: str) -> tuple[str, str, str, bool] | None:
            plain = _plain(value)
            if not plain or plain == "—":
                return None
            for symbol, (key, label, mark) in _COVERAGE_STATES.items():
                if symbol in plain:
                    return key, label, mark, "🔗" in plain
            return "unknown", "Recorded outcome", "?", "🔗" in plain

        for values, markers in rows:
            identity = values[0]
            link = re.search(r"\[([^]]+)\]\(([^)]+)\)", identity)
            subsystem_id = _plain(link.group(1)) if link else _plain(identity).split(" ", 1)[0]
            route = _html_href(link.group(2)) if link else self._route(subsystem_id)
            subsystem_name = _plain(identity)
            if subsystem_name.startswith(subsystem_id):
                subsystem_name = subsystem_name[len(subsystem_id) :].strip()
            subsystem_name = subsystem_name or subsystem_id

            reviews: list[dict[str, Any]] = []
            counts: dict[str, int] = {}
            for code, value in zip(concern_codes, values[1:], strict=True):
                state = outcome(value)
                if not state:
                    continue
                key, label, mark, linchpin = state
                counts[key] = counts.get(key, 0) + 1
                if key in totals:
                    totals[key] += 1
                if linchpin:
                    linchpin_total += 1
                reviews.append(
                    {
                        "code": code,
                        "key": key,
                        "label": label,
                        "mark": mark,
                        "linchpin": linchpin,
                    }
                )
            records.append(
                {
                    "markers": markers,
                    "id": subsystem_id,
                    "name": subsystem_name,
                    "route": route,
                    "reviews": reviews,
                    "counts": counts,
                }
            )

        review_total = sum(len(record["reviews"]) for record in records)
        intersection_total = len(records) * len(concern_codes)
        unassessed = intersection_total - review_total

        summary_items = (
            (review_total, "Recorded reviews"),
            (len(records), "Subsystems"),
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
        for record in records:
            route = str(record["route"] or "")
            name = str(record["name"])
            subsystem_id = str(record["id"])
            name_html = html.escape(name)
            primary = (
                f'<a href="{html.escape(route, quote=True)}">{name_html}</a>'
                if route
                else name_html
            )
            reviews = list(record["reviews"])
            reviewed = len(reviews)
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
                if (count := record["counts"].get(key, 0))
            )

            tokens: list[str] = []
            review_map = {review["code"]: review for review in reviews}
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

                key = str(review["key"])
                label = str(review["label"])
                mark = str(review["mark"])
                linchpin = bool(review["linchpin"])
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

            marker_html = "".join(record["markers"])
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

        legend_items = [
            (key, label, mark)
            for key, label, mark in _COVERAGE_STATES.values()
        ]
        legend = "".join(
            f'<span class="coverage-legend-item coverage-state-{html.escape(key, quote=True)}">'
            f'<span class="coverage-token-mark" aria-hidden="true">{html.escape(mark)}</span>'
            f'<span>{html.escape(label)}</span></span>'
            for key, label, mark in legend_items
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
            f'<span>{len(records)} subsystems × {len(concern_codes)} concerns</span></summary>'
            '<p class="coverage-matrix-note">Use the matrix when exact row-and-column comparison matters. '
            'Headers and subsystem names remain fixed while the matrix scrolls.</p>'
            + matrix
            + '</details></div>'
        )

    def _table(
        self,
        headers: list[str],
        rows: list[tuple[list[str], list[str]]],
        caption: str,
    ) -> str:
        signature = tuple(_header_key(header) for header in headers)
        if signature == _SUBSYSTEM_ATLAS_PROJECTION:
            return self._subsystem_atlas(rows, caption)
        if signature == _DEPENDENCY_TOPOLOGY_PROJECTION:
            return self._connection_topology(rows, caption, kind="dependency")
        if signature == _SEAM_TOPOLOGY_PROJECTION:
            return self._connection_topology(rows, caption, kind="seam")
        if signature == _RUNTIME_BOUNDARY_PROJECTION:
            return self._runtime_boundary_diagram(rows, caption)
        if signature == _CONCERN_CHECKLIST_PROJECTION:
            return self._concern_checklist(headers, rows, caption)
        if (
            len(signature) > 1
            and signature[0] == "subsystem"
            and all(_IDENTIFIER_PATTERN.fullmatch(header.upper()) for header in signature[1:])
        ):
            return self._coverage_index(headers, rows)
        projection = _RECORD_PROJECTIONS.get(signature)
        if projection:
            return self._record_list(headers, rows, caption, projection)
        if signature in _SUMMARY_LIST_PROJECTIONS:
            return self._summary_list(rows, caption)

        lifecycle = signature in _LIFECYCLE_TABLE_PROJECTIONS
        visible_headers = [header for index, header in enumerate(headers) if not lifecycle or index != 1]
        head = "".join(f'<th scope="col">{_inline(cell)}</th>' for cell in visible_headers)
        table_rows: list[str] = []
        for values, markers in rows:
            cells: list[str] = []
            for index, value in enumerate(values):
                if lifecycle and index == 1:
                    continue
                label = _plain(headers[index])
                if lifecycle and index == 0:
                    location = values[1]
                    location_html = (
                        f'<span class="table-detail"><span class="visually-hidden">Location: </span>{_inline(location)}</span>'
                        if _plain(location)
                        else ""
                    )
                    cells.append(
                        f'<th scope="row" data-label="{html.escape(label, quote=True)}"><span class="table-key">{_inline(value)}</span>{location_html}</th>'
                    )
                else:
                    cells.append(
                        f'<td data-label="{html.escape(label, quote=True)}">{_inline(value)}</td>'
                    )
            table_rows.append("".join(markers) + f'<tr>{"".join(cells)}</tr>')
        kind = " lifecycle-table" if lifecycle else ""
        return (
            f'<div class="table-wrap{kind}"><table><caption>{html.escape(caption)}</caption>'
            f'<thead><tr>{head}</tr></thead><tbody>{"".join(table_rows)}</tbody></table></div>'
        )

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

            if (
                current_section in {"coverage-overview", "coverage-heatmap"}
                and line.startswith("**Legend**:")
            ):
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
                display_raw = raw
                if (
                    self.current_html_path == "concern-checklist.html"
                    and level == 2
                    and re.fullmatch(r"Active concerns(?:\s+\(\d+\))?", _plain(raw), re.IGNORECASE)
                ):
                    display_raw = "Active concerns"
                if level == 2:
                    if in_section:
                        body.append("</section>")
                    current_section = slugify(_plain(display_raw))
                    body.append(f'<section class="section-{html.escape(current_section, quote=True)}">')
                    in_section = True
                anchor_id = self._heading_slug(display_raw)
                label = html.escape(f"Link to {_plain(display_raw)}", quote=True)
                finding_group = self.current_html_path == "findings.html" and level == 3
                heading_class = ' class="finding-subsystem-heading"' if finding_group else ""
                definition_context = " data-identifier-defined" if finding_group else ""
                body.append(
                    f'<h{level}{heading_class} id="{anchor_id}"{definition_context}>'
                    f'<a class="heading-anchor" href="#{anchor_id}" aria-label="{label}">§</a>'
                    f'{_inline(display_raw)}</h{level}>'
                )
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
                normalized_rows = []
                for values, markers in rows:
                    values += [""] * max(0, len(headers) - len(values))
                    normalized_rows.append((values[: len(headers)], markers))
                body.append(self._table(headers, normalized_rows, caption))
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
        return title, "\n".join(_compose_prose_runs(body))


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
        if element.startswith("<p>") and element.endswith("</p>"):
            run.append(element)
            continue
        flush()
        composed.append(element)
    flush()
    return composed


def _page_eyebrow(page: SitePage) -> str:
    if page.kind == "subsystem":
        record = html.escape(page.record_id or "record")
        return f'Subsystem · <span data-identifier-defined>{record}</span>'
    if page.kind == "matrix":
        record = html.escape(page.record_id or "matrix")
        return f'Competing explanations · <span data-identifier-defined>{record}</span>'
    return html.escape(page.group)


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
            record = (
                f'<span class="nav-id" data-identifier-defined>{html.escape(page.record_id)}</span>'
                if page.record_id
                else ""
            )
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
    project_name = str(context.get("project_name") or "Project")
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
    definitions = {
        str(identifier): str(definition)
        for identifier, definition in dict(
            context.get("identifier_definitions") or {}
        ).items()
    }
    nav = _identifier_markup(_nav(pages, page), definitions)
    body = _identifier_markup(body, definitions)
    eyebrow = _identifier_markup(_page_eyebrow(page), definitions)
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Amanuensis HTML projection {HTML_PROJECTION_VERSION}">
<meta name="description" content="{html.escape(page.hint, quote=True)}">
<title>{html.escape(display_title)} · {html.escape(project_name)} · Amanuensis</title>
<script>document.documentElement.classList.add('js');try{{const t=localStorage.getItem('amanuensis-theme');if(t)document.documentElement.dataset.theme=t}}catch(e){{}}</script>
<style>{_CSS}</style>
</head>
<body>
<a class="skip-link" href="#content">Skip to content</a>
<div class="shell">
  <aside class="nav-rail" aria-label="{html.escape(project_name, quote=True)} report navigation">
    <a class="brand" href="{html.escape(home_link, quote=True)}">
      <span class="brand-mark">{html.escape(project_name)}</span>
      <span class="brand-sub">Architecture survey · Amanuensis</span>
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
    <div class="mobile-bar"><span class="mobile-brand">{html.escape(project_name)}</span><button class="quiet-button" type="button" data-nav-toggle aria-expanded="false">Browse</button></div>
    <div class="document-inner">
      <header class="page-head">
        <p class="eyebrow">{eyebrow}</p>
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
      <article class="content content-{html.escape(slugify(page.kind), quote=True)}">{body}</article>
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
        parser = MarkdownRenderer(
            route_map,
            page.html_path,
            repository_url=str(context.get("repository_url") or "") or None,
        )
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
