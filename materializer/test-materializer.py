#!/usr/bin/env python3
"""End-to-end test: seed a temp conspectus, materialize it, verify output.

Runs twice to exercise diff-aware behavior: the second run should
re-render almost nothing.
"""
from __future__ import annotations

import json
import re
import sqlite3
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

from store_only_seed import import_body, import_onboarding, withdraw_import

ROOT = Path(__file__).resolve().parent
SCHEMA = ROOT.parent / "mcp-server" / "src" / "schema.sql"


class _Outline(HTMLParser):
    """The visible words of a page's `<article>`, one block per line, with each
    heading on a line of its own led by one `#` per level."""

    _BREAKS = frozenset(
        (
            "p", "li", "tr", "div", "section", "pre", "ul", "ol", "table", "br",
            "blockquote", "caption", "dt", "dd", "article", "details", "summary",
        )
    )

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[str] = []
        self._buf: list[str] = []
        self._in_article = False
        self._skip = 0
        self._heading = 0

    def _flush(self) -> None:
        words = " ".join("".join(self._buf).split())
        self._buf = []
        if words:
            self.lines.append(("#" * self._heading + " " if self._heading else "") + words)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        classes = (dict(attrs).get("class") or "").split()
        if tag == "article":
            self._in_article = True
        elif tag in ("script", "style") or (tag == "a" and "heading-anchor" in classes):
            self._skip += 1
        elif self._in_article and tag in self._BREAKS:
            self._flush()
        elif self._in_article and re.fullmatch(r"h[1-6]", tag):
            self._flush()
            self._heading = int(tag[1])

    def handle_endtag(self, tag: str) -> None:
        if tag == "article":
            self._flush()
            self._in_article = False
        elif tag in ("script", "style", "a") and self._skip:
            self._skip -= 1
        elif self._in_article and re.fullmatch(r"h[1-6]", tag):
            self._flush()
            self._heading = 0
        elif self._in_article and tag in self._BREAKS:
            self._flush()
        elif self._in_article and tag in ("td", "th"):
            self._buf.append(" ")

    def handle_data(self, data: str) -> None:
        if self._in_article and not self._skip:
            self._buf.append(data)


def outline(page: str) -> str:
    parser = _Outline()
    parser.feed(page)
    parser.close()
    return "\n".join(parser.lines)


def seed(db: sqlite3.Connection) -> None:
    db.executescript((SCHEMA).read_text())
    cur = db.cursor()
    # git state
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha, last_checked_sha, branch_convention) "
        "VALUES ('default', 'main', 'deadbeefdeadbeef', 'deadbeefdeadbeef', 'trunk-based')"
    )
    # session
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('s1', 'onboarding')")
    # subsystems
    cur.executemany(
        "INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading, notes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            ("B-01", "Job Scheduler", "mapped", "backend", "scheduler/**", "scheduler/main.ts", "Note about B-01"),
            ("B-02", "Auth Service", "mapped", "backend", "auth/**", "auth/index.ts", ""),
            ("F-01", "Web UI", "scoping", "frontend", "web/**", "web/main.tsx", ""),
        ],
    )
    # concerns
    cur.executemany(
        "INSERT INTO concerns (code, category, origin, status) VALUES (?, ?, ?, 'active')",
        [
            ("CC-1", "cache-coherence", "seeded"),
            ("CB-1", "concurrency", "seeded"),
            ("TC-1", "trust-boundary", "seeded"),
        ],
    )
    # dispositions
    cur.executemany(
        "INSERT INTO dispositions (subsystem_id, concern_code, classification, evidence, evidence_quality, rationale, ref_sha, session_id, pass_type) "
        "VALUES (?, ?, ?, ?, ?, ?, 'deadbeef', 's1', 'survey')",
        [
            ("B-01", "CC-1", "ruled-out", "scheduler/main.ts:runJob@deadbeef", "code-verified", "No cache in B-01."),
            ("B-01", "CB-1", "confirmed-acceptable", "scheduler/main.ts:runJob@deadbeef", "code-verified", "Single goroutine per job."),
            ("B-02", "TC-1", "confirmed-bug", "auth/gateway.ts:parse@deadbeef", "code-verified", "Gateway trusts unvalidated client input."),
        ],
    )
    # xrefs
    cur.execute(
        "INSERT INTO xrefs (from_id, to_id, relationship, strength, context) "
        "VALUES ('B-01', 'B-02', 'dependency', 'confirmed', 'B-01 calls B-02 on job start')"
    )
    # seams
    cur.execute(
        "INSERT INTO seams (id, shared_object, shared_object_kind, party_a, party_b, a_writes, b_reads, ordering_assumption, cardinality, staleness_tolerance) "
        "VALUES ('SM-01', 'jobs_queue', 'queue', 'B-01', 'B-02', 'enqueue job', 'dequeue', 'fifo', 'single-consumer', 'strong-consistent')"
    )
    # findings
    cur.execute(
        "INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity, status, primary_files, business_context, ref_sha, session_id, pass_type) "
        "VALUES ('B02-1', 'B-02', 'Unvalidated query params reach SQL', 'parse trusts client claim', 'HIGH', 'confirmed-bug', ?, 'Affects all auth flows', 'deadbeef', 's1', 'adversarial')",
        (json.dumps(["auth/gateway.ts:parse@deadbeef"]),),
    )
    cur.execute(
        "INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity, status, ref_sha, session_id, pass_type) "
        "VALUES ('B01-1', 'B-01', 'race on job start', 'lock released between check and start', 'MEDIUM', 'confirmed-acceptable', 'deadbeef', 's1', 'survey')"
    )
    # evidence
    cur.execute(
        "INSERT INTO evidence (file_path, symbol, ref_sha, kind, note) VALUES "
        "('auth/gateway.ts', 'parse', 'deadbeef', 'code-verified', 'Unsanitized input flows to SQL')"
    )
    ev1_id = cur.lastrowid
    cur.execute(
        "INSERT INTO evidence (file_path, symbol, ref_sha, kind, note) VALUES "
        "('auth/gateway.ts', 'parse', 'deadbeef', 'comment-asserted', 'Docstring claims sanitization')"
    )
    ev2_id = cur.lastrowid
    cur.execute(
        "INSERT INTO finding_evidence (finding_id, evidence_id, role) VALUES ('B02-1', ?, 'root-cause')",
        (ev1_id,),
    )
    cur.execute(
        "INSERT INTO disposition_evidence (subsystem_id, concern_code, evidence_id, role) VALUES ('B-02', 'TC-1', ?, 'supports')",
        (ev1_id,),
    )
    # diagnosticity matrix
    cur.execute(
        "INSERT INTO diagnosticity_sessions (subsystem_id, symptom, shared_location, leading_concern, outcome, session_id) "
        "VALUES ('B-02', 'Intermittent auth bypass', 'auth/gateway.ts:parse@deadbeef', 'TC-1', 'resolved', 's1')"
    )
    mid = cur.lastrowid
    cur.executemany(
        "INSERT INTO diagnosticity_concerns (matrix_id, concern_code) VALUES (?, ?)",
        [(mid, "TC-1"), (mid, "CB-1")],
    )
    cur.execute(
        "INSERT INTO diagnosticity_evidence (matrix_id, evidence_id, row_order) VALUES (?, ?, 1)",
        (mid, ev1_id),
    )
    cur.execute(
        "INSERT INTO diagnosticity_evidence (matrix_id, evidence_id, row_order) VALUES (?, ?, 2)",
        (mid, ev2_id),
    )
    cur.executemany(
        "INSERT INTO diagnosticity_cells (matrix_id, concern_code, evidence_id, verdict, note) VALUES (?, ?, ?, ?, ?)",
        [
            (mid, "TC-1", ev1_id, "consistent", "matches trust-boundary elision"),
            (mid, "CB-1", ev1_id, "contradicts", "no concurrency at this point"),
            (mid, "TC-1", ev2_id, "contradicts", "doc claim contradicts TC-1 if trusted"),
            (mid, "CB-1", ev2_id, "irrelevant", "doc says nothing about concurrency"),
        ],
    )
    # field notes
    cur.executemany(
        "INSERT INTO field_notes (category, observation, location, ref_sha, session_id, follow_up) VALUES (?, ?, ?, 'deadbeef', 's1', ?)",
        [
            ("anomaly", "Auth error paths rarely tested", "auth/gateway.ts", "open"),
            ("tension", "Scheduler and auth share a queue that assumes single consumer", "SM-01", "open"),
        ],
    )
    # vocabulary
    cur.executemany(
        "INSERT INTO vocabulary (term, gloss, subsystem_id, first_seen, ref_sha) VALUES (?, ?, ?, ?, 'deadbeef')",
        [
            ("runJob", "per-job entry point in the scheduler", "B-01", "scheduler/main.ts:runJob@deadbeef"),
            ("gateway", "request entry-point service in front of auth", None, "auth/gateway.ts:main@deadbeef"),
        ],
    )
    # artifacts
    cur.executemany(
        "INSERT INTO artifacts (path, kind, subsystem_id, ref_sha, session_id) VALUES (?, ?, ?, 'deadbeef', 's1')",
        [
            ("entry-point.md", "entry-point", None),
            ("onboarding-report.md", "onboarding-report", None),
        ],
    )
    db.commit()


def with_assets(page: Path) -> str:
    """The page's HTML followed by the shared stylesheet and script it links."""
    html = page.read_text()
    parts = [html]
    for ref in re.findall(r'<link rel="stylesheet" href="([^"]+)"|<script src="([^"]+)"', html):
        target = next(r for r in ref if r)
        asset = (page.parent / target).resolve()
        if asset.suffix in {".css", ".js"} and asset.parent.name == "assets":
            parts.append(asset.read_text())
    return "\n".join(parts)


def run_materializer(storage: Path) -> dict:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        print("STDOUT:", proc.stdout)
        print("STDERR:", proc.stderr)
        raise SystemExit(f"materializer exited {proc.returncode}")
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    if not lines:
        raise SystemExit("no JSON summary on stdout")
    return json.loads(lines[-1])


def main() -> None:
    with tempfile.TemporaryDirectory() as td:
        storage = Path(td)
        # Prose the store holds as imports, to prove the imported pages and typed
        # HTML projections work. The pages read the import, never a file.
        entry_point = (
            "# Entry point\n\nThis is a fictional test codebase with three subsystems: "
            "B-01 (scheduler), B-02 (auth), and F-01 (web UI). The seam SM-01 connects them.\n\n"
            "## File ledger\n\n"
            "| Path | Classification | Why in scope | Ref SHA |\n"
            "|---|---|---|---|\n"
            "| `scheduler/main.ts` | examined | Owns the job dispatch boundary and its auth call. | `deadbeef` |\n\n"
            "## State containers\n\n"
            "| Name | Location | Stores | Lifetime | Populated by | Invalidated by |\n"
            "|---|---|---|---|---|---|\n"
            "| `JobQueue` | `scheduler/main.ts` | Pending jobs | Process | Dispatcher | Restart |\n\n"
            "## Non applicable territories\n\n"
            "| Territory | Attenuating condition |\n"
            "|---|---|\n"
            "| Native memory | The runtime owns allocation for this service. |\n"
        )
        onboarding_report = (
            "# Onboarding report\n\n**Codebase**: FictionalProject — materializer fixture\n\n"
            "## Directory clusters\n\n- scheduler/ — B-01\n- auth/ — B-02\n- web/ — F-01\n\n"
            "## Runtime boundary map\n\n"
            "| Runtime / Process | Language | Communicates with | Mechanism | Notes |\n"
            "|---|---|---|---|---|\n"
            "| Host agent | external | scheduler service | stdio RPC | Starts the scheduler process. |\n"
            "| Scheduler service | Python | auth service | HTTPS request | Dispatches authenticated jobs. |\n"
            "| Auth service | TypeScript | policy database | SQL transaction | Owns authorization decisions. |\n"
        )
        concern_checklist = (
            "# Concern checklist (calibrated)\n\n"
            "## Active concerns (3)\n\n"
            "| Code | Category | Territory | Codebase-specific probe (abbreviated) | Primary subsystems |\n"
            "|---|---|---|---|---|\n"
            "| CC-1 | cache-coherence | T2 | Does the scheduler retain stale authorization state after a policy change? | B-01, B-02 |\n"
            "| CC-2 | cache-coherence | T2 | Trace every holder of the shared policy snapshot. | B-02 |\n"
            "| TC-1 | trust-boundary | T10 | Verify that every public request path validates its caller. | B-02, F-01 |\n"
        )
        (storage / "workspace_path").write_text("/example/FictionalProject\n")
        db = sqlite3.connect(storage / "memory.db")
        seed(db)
        import_onboarding(
            db,
            session_id="s1",
            entry_point=entry_point,
            onboarding_report=onboarding_report,
            concern_checklist=concern_checklist,
            ref_sha="deadbeef",
        )
        db.commit()
        db.close()

        # First run — should render everything.
        summary1 = run_materializer(storage)
        print("run 1:", json.dumps(summary1, indent=2))
        assert summary1["ok"] is True, summary1
        assert summary1["html_entrypoint"] == str((storage / "docs" / "index.html").resolve())
        assert summary1["pages_rendered"] > 0
        assert summary1["pages_unchanged"] == 0, summary1
        # A relocated store's old workspace_path must not override the MCP
        # connection's explicit checkout, for rendering or independent read-back.
        relocated = storage / "relocated-docs"
        bound_run = subprocess.run(
            [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage),
             "--workspace", str(ROOT.parent), "--allow-external-output",
             "--output", str(relocated)],
            capture_output=True, text=True, check=True,
        )
        bound_summary = json.loads(bound_run.stdout.strip().splitlines()[-1])
        assert bound_summary["ok"] is True, bound_summary
        head = subprocess.check_output(
            ["git", "-C", str(ROOT.parent), "rev-parse", "HEAD"], text=True,
        ).strip()
        assert head[:12] in (relocated / "index.html").read_text()
        assert (storage / "workspace_path").read_text() == "/example/FictionalProject\n"
        # Verify key pages exist.
        docs = storage / "docs"
        for p in [
            "index.html", "architecture.html", "master-plan.html", "findings.html",
            "concerns.html", "seams.html", "contradictions.html", "diagnosticity.html",
            "vocabulary.html", "field-notes.html", "entry-point.html", "onboarding-report.html",
            "concern-checklist.html",
            "how-to-read.html",
            "subsystems/b01-job-scheduler.html", "subsystems/b02-auth-service.html",
            "subsystems/f01-web-ui.html",
        ]:
            assert (docs / p).is_file(), f"missing: {p}"
            assert '<article class="content' in (docs / p).read_text(), f"no article in HTML page: {p}"
        html_index = with_assets(docs / "index.html")
        assert "Amanuensis HTML projection" in html_index
        assert "FictionalProject" in html_index
        assert "Architecture survey · Amanuensis" in html_index
        assert 'aria-label="FictionalProject report navigation"' in html_index
        assert "Find a page" in html_index
        assert "Reading hint" not in html_index
        assert "Living architecture" not in html_index
        assert "--paper" not in html_index and "Iowan Old Style" in html_index
        assert "--accent: #48651f" in html_index
        assert "--measure: 120ch" in html_index
        assert "column-count: 2" in html_index and "column-count: 3" in html_index
        assert "--page: 128rem" in html_index
        assert "@container report (min-width: 120ch)" in html_index
        assert "@container report (min-width: 190ch)" in html_index
        assert "@media (min-width: 1180px)" not in html_index
        assert ".page-hint { max-width: none" in html_index
        assert "border-radius: 999px" not in html_index
        assert ".js .nav-rail" in html_index, "mobile drawer must be enhancement-only"
        assert ":is(h2, h3, h4, h5, h6) { scroll-margin-top: 4.75rem; }" in html_index
        assert "navRail.inert" in html_index, "closed enhanced drawer must leave the tab order"
        assert "setMenuOpen(false, true)" in html_index, "Escape must close the drawer and restore focus"
        assert "const themeStorageKey = 'amanuensis-theme';" in html_index
        assert "window.addEventListener('storage'" in html_index
        assert "if (event.key !== themeStorageKey) return;" in html_index
        assert "applyTheme(event.newValue);" in html_index
        assert "systemTheme.addEventListener?.('change', updateThemeLabel);" in html_index
        assert 'href="findings.html"' in html_index
        assert "https://" not in html_index, "HTML shell must not depend on a remote asset"
        html_findings = with_assets(docs / "findings.html")
        assert 'href="subsystems/b02-auth-service.html"' in html_findings
        assert '<h4 class="finding-subsystem-heading"' in html_findings
        assert '>Auth Service</a></h4>' in html_findings
        assert '<span class="status status-resolution status-open">Open</span>' in html_findings
        assert 'class="record-list record-list-finding"' in html_findings
        assert 'class="record record-finding"' in html_findings
        assert '<header class="record-meta" data-identifier-defined>' in html_findings
        assert '<h4 class="record-primary"' in html_findings
        assert 'class="record-lede"' in html_findings and "Root cause" in html_findings
        assert '.record-lede { max-width: var(--measure);' in html_findings
        assert 'font-feature-settings: "kern" 1, "liga" 1, "clig" 1;' in html_findings
        assert 'h1, h2, .brand-mark, .record-primary, .record-lede' in html_findings
        assert 'class="content content-findings"' in html_findings
        assert 'id="high-findings"' in html_findings
        assert '>High findings</h3>' in html_findings
        assert 'Link to High findings' in html_findings
        # Spec 6.1 groups the Unresolved lens by resolution state first, so the
        # page's h2 sections are the states and severity nests inside them.
        assert '<section class="section-open">' in html_findings
        assert html_findings.index('<section class="section-open">') < html_findings.index(
            '>High findings</h3>'
        )
        assert 'class="severity severity-high"' not in html_findings
        assert 'record-fact-severity' not in html_findings
        assert 'record-fact-subsystem' not in html_findings
        assert '.content > * + section { margin-top: var(--section-gap); }' in html_findings
        assert 'border-bottom: 1px solid var(--rule)' not in html_findings.split('.content > section', 1)[1].split('}', 1)[0]
        assert '.record-finding { display: block; }' in html_findings
        assert 'grid-template-columns: minmax(0, 1fr) max-content; gap: .4rem 1rem' in html_findings
        assert "@container report (max-width: 92ch)" in html_findings
        assert ".record-finding .record-facts > div" in html_findings
        assert ".record-finding .record-fact-ref-sha { justify-self: end; }" in html_findings
        assert ".record-finding .record-fact-ref-sha dt" in html_findings
        assert "@container report (max-width: 52ch)" in html_findings
        assert ".record-finding .record-fact-ref-sha code { white-space: nowrap" in html_findings
        first_finding_bar = html_findings.split('<article class="record record-finding"', 1)[1].split("</header>", 1)[0]
        assert 'class="identifier-definition"' not in first_finding_bar
        assert ' title=' not in first_finding_bar
        assert '--canvas-subtle: #eaeae6' in html_findings
        assert '--surface: #fbfcf7' in html_findings
        assert '--accent: #48651f' in html_findings
        assert '--survey-mapped: #315c18' in html_findings
        assert '--evidence-code: #3f611f' in html_findings
        assert '.severity-critical { --enum-color: var(--severity-critical); }' in html_findings
        assert '.severity-high { --enum-color: var(--severity-high); }' in html_findings
        assert 'background: color-mix(in srgb, var(--enum-color) 10%, var(--surface));' in html_findings
        assert '.content-findings section > h2::before' in html_findings
        assert 'background: var(--source-aligned)' in html_findings
        html_concerns = with_assets(docs / "concerns.html")
        assert 'class="identifier-definition"' in html_concerns
        assert 'title="CC-1 — Cache Coherence"' in html_concerns
        assert 'aria-label="CC-1 — Cache Coherence"' in html_concerns
        assert 'id="coverage-overview"' in html_concerns
        assert 'class="coverage-index"' in html_concerns
        assert '.coverage-intro { max-width: var(--measure);' in html_concerns
        assert '.coverage-matrix-note { max-width: var(--measure);' in html_concerns
        assert '<strong>3</strong><span>Recorded reviews</span>' in html_concerns
        assert html_concerns.count('<article class="coverage-subsystem">') == 3
        assert html_concerns.count('class="coverage-token coverage-state-') == 3
        assert '.coverage-state-confirmed-acceptable { --enum-color: var(--disposition-acceptable); }' in html_concerns
        assert '.coverage-state-ruled-out { --enum-color: var(--disposition-ruled-out); }' in html_concerns
        assert "align-content: start" in html_concerns
        assert "align-items: flex-start; align-self: start" in html_concerns
        assert '<span class="coverage-subsystem-id" data-identifier-defined>B-01</span>' in html_concerns
        assert '<span class="coverage-matrix-subsystem-id" data-identifier-defined>B-01</span>' in html_concerns
        assert 'class="coverage-subsystem-id"><abbr' not in html_concerns
        assert 'class="coverage-matrix-subsystem-id"><abbr' not in html_concerns
        assert '<details class="coverage-matrix-disclosure">' in html_concerns
        assert '<table class="coverage-matrix">' in html_concerns
        assert html_concerns.count('<td class="coverage-matrix-empty">') == 6
        assert 'href="subsystems/b02-auth-service.html#concern-disposition-tc-1"' in html_concerns
        assert "Coverage heatmap" not in html_concerns
        html_checklist = with_assets(docs / "concern-checklist.html")
        assert 'id="active-concerns"' in html_checklist
        assert '>Active concerns</h2>' in html_checklist
        assert "Active concerns (3)" not in html_checklist
        assert 'class="concern-family-heading"' in html_checklist
        assert '<span>Cache coherence</span><span class="concern-territory">T2</span>' in html_checklist
        assert html_checklist.count('class="record record-concern-checklist"') == 3
        assert 'class="record-list record-list-concern-checklist"' in html_checklist
        assert 'record-fact-category' not in html_checklist
        assert 'record-fact-territory' not in html_checklist
        assert '<dt>Review in</dt>' in html_checklist
        assert 'class="record-probe"' in html_checklist
        assert '.record-probe { max-width: var(--measure);' in html_checklist
        first_concern_bar = html_checklist.split('<article class="record record-concern-checklist"', 1)[1].split("</header>", 1)[0]
        assert 'class="identifier-definition"' not in first_concern_bar.split('<dl class="record-facts">', 1)[0]
        assert 'title="B-01 — Job Scheduler"' in first_concern_bar
        assert '<table' not in html_checklist
        assert "<table" not in html_findings and "<p>|" not in html_findings
        html_entry = with_assets(docs / "entry-point.html")
        assert 'class="record-list record-list-file-ledger"' in html_entry
        assert "scheduler/main.ts" in html_entry and "Why this file is in scope" in html_entry
        assert 'class="table-wrap lifecycle-table"' in html_entry
        assert "Location: " in html_entry and "JobQueue" in html_entry
        assert 'class="summary-list"' in html_entry and "Native memory" in html_entry
        html_master_plan = with_assets(docs / "master-plan.html")
        assert 'class="record-list record-list-subsystem"' in html_master_plan
        assert 'class="record-fact record-fact-id"' in html_master_plan
        assert '<dd><span data-identifier-defined>' in html_master_plan
        assert 'class="nav-id" data-identifier-defined>B-01</span>' in html_master_plan
        assert 'class="nav-id"><abbr' not in html_master_plan
        html_b02 = with_assets(docs / "subsystems/b02-auth-service.html")
        assert 'class="record-list record-list-concern-disposition"' in html_b02
        # A concern review says where its attached evidence points; a concern code
        # heading its own record is not prefixed "concern".
        tc1 = html_b02.split('id="concern-disposition-tc-1"', 1)[1].split("</article>", 1)[0]
        assert '<p class="record-label">Evidence at</p>' in tc1 and "<code>auth/gateway.ts</code>" in tc1, tc1
        assert ">concern <abbr" not in tc1 and ">concern <abbr" not in html_concerns
        # A seeded concern was discovered in no subsystem: no "Discovered in —" fact.
        assert "Discovered in" not in html_concerns
        assert 'Subsystem · <span data-identifier-defined>B-02</span>' in html_b02
        assert '.record-concern-disposition { display: block; }' in html_b02
        assert 'white-space: nowrap; overflow-wrap: normal;' in html_b02
        assert 'title="TC-1 — Trust Boundary"' in html_b02
        assert 'class="status status-disposition status-confirmed-bug"' in html_b02
        assert 'class="evidence-label evidence-code-verified"' in html_b02
        html_architecture = with_assets(docs / "architecture.html")
        assert "A generated mermaid version will replace this placeholder" not in html_architecture
        # The runtime boundary table's columns, as the HTML presents each boundary:
        # its name and language in the heading, then one labelled line per column.
        assert '<h3>Host agent</h3><span class="runtime-detail-language">external</span>' in html_architecture
        for column in ("Communicates with", "Mechanism", "Recorded note"):
            assert f'<span class="runtime-detail-label">{column}</span>' in html_architecture, column
        assert '<svg class="runtime-boundary-svg"' in html_architecture
        assert 'aria-labelledby="runtime-boundary-svg-title runtime-boundary-svg-description"' in html_architecture
        assert "3 recorded runtime boundaries" in html_architecture
        assert "Host agent" in html_architecture and "stdio RPC" in html_architecture
        assert 'class="runtime-boundary-details"' in html_architecture
        assert "mermaid.initialize" not in html_architecture
        assert "mermaid.min.js" not in html_architecture and "@mermaid-js" not in html_architecture
        assert '<div class="topology topology-dependency"' in html_architecture
        assert '<div class="topology topology-seam"' in html_architecture
        assert "jobs_queue" in html_architecture and "Connected area" in html_architecture

        # A nodes-only dependency source must fail closed into a linked layer
        # atlas rather than exposing raw Mermaid or implying edges.
        from amanuensis_materializer.core import _compact_definition
        from amanuensis_materializer.diagrams import dependency_blocks
        from amanuensis_materializer.html_projection import write_html
        from amanuensis_materializer.legacy_prose import render_body
        from amanuensis_materializer.page import Page, Paragraph, Section
        from amanuensis_materializer.prose import parse_inlines

        assert _compact_definition(
            "Atomicity", "T7, and an internal documentation contradiction."
        ) == "Atomicity: An internal documentation contradiction."

        atlas_db = sqlite3.connect(storage / "memory.db")
        atlas_db.row_factory = sqlite3.Row
        atlas_db.execute("DELETE FROM xrefs")
        atlas_blocks = dependency_blocks(atlas_db, "subsystem atlas")
        atlas_db.rollback()
        atlas_db.close()
        atlas_body = write_html(Page("Architecture", "architecture.html", (Section("subsystem-atlas", atlas_blocks),)))
        assert 'class="subsystem-atlas"' in atlas_body
        assert "not an inferred dependency graph" in atlas_body
        assert "<table" not in atlas_body and "Diagram source" not in atlas_body
        assert ".content > section {" in html_architecture
        assert ".atlas-regions { display: grid;" in html_architecture
        assert "align-items: start; border-left: 1px solid var(--rule);" in html_architecture

        # A file ledger table in an imported body prints as records. Its paths link to
        # the repository on a branch the origin has; the row's revision is kept as data,
        # since a commit the remote lacks would 404. With no known branch, no link.
        ledger = render_body(
            "| Path | Classification | Why in scope | Ref SHA |\n"
            "|---|---|---|---|\n"
            "| `scheduler/main.ts` | examined | Owns dispatch. | `deadbeef` |\n",
            under=2,
            section="File ledger",
            path="entry-point.html",
        )
        github_ledger = write_html(
            Page("Files", "entry-point.html", (Section("file-ledger", ledger),)),
            {},
            repository_url="https://github.com/acme/fictional",
            repository_ref="main",
        )
        assert 'href="https://github.com/acme/fictional/blob/main/scheduler/main.ts"' in github_ledger
        assert 'data-source-path="scheduler/main.ts"' in github_ledger
        assert 'data-source-rev="deadbeef"' in github_ledger
        unlinked_ledger = write_html(
            Page("Files", "entry-point.html", (Section("file-ledger", ledger),)),
            {},
            repository_url="https://github.com/acme/fictional",
        )
        assert "https://github.com" not in unlinked_ledger
        assert 'data-source-path="scheduler/main.ts"' in unlinked_ledger
        # A path the linked branch does not hold (added since the last push, or deleted
        # and still named by an imported table) is marked and not linked.
        absent_ledger = write_html(
            Page("Files", "entry-point.html", (Section("file-ledger", ledger),)),
            {},
            repository_url="https://github.com/acme/fictional",
            repository_ref="main",
            linkable_paths=frozenset({"scheduler/other.ts"}),
        )
        assert "https://github.com" not in absent_ledger
        assert 'data-source-path="scheduler/main.ts"' in absent_ledger
        long_paragraph = "A precise architectural account remains readable when its evidence and limits stay adjacent. " * 10
        column_prose = write_html(
            Page(
                "Reading field",
                "entry-point.html",
                (Section("account", (Paragraph(parse_inlines(long_paragraph.strip())), Paragraph(parse_inlines(long_paragraph.strip())))),),
            )
        )
        assert '<div class="prose-flow">' in column_prose
        assert column_prose.index(long_paragraph.strip()) < column_prose.rindex(long_paragraph.strip())
        humanized_prose = write_html(
            Page(
                "Record",
                "entry-point.html",
                (Section("history", (Paragraph(parse_inlines("**Concern dispositions** were recorded after **Jump-in reading**.")),)),),
            )
        )
        assert "Concern review" in humanized_prose and "Start here" in humanized_prose
        assert "Concern dispositions" not in humanized_prose and "Jump-in reading" not in humanized_prose
        # The reader's guide is static — every conspectus ships with it.
        # Sanity-check that the content actually landed.
        htr_html = (docs / "how-to-read.html").read_text()
        htr = outline(htr_html)
        assert "Reader&#x27;s guide" in htr_html
        assert "### Survey depth" in htr and "cannot justify" in htr.lower()  # the survey-depth ladder is generated from the enum source
        assert "evidence quality" in htr.lower()
        assert "\x00" not in htr, "nested xref placeholders leaked into the page's text"
        assert "\x00" not in htr_html, "xref placeholders leaked into HTML"
        # The index should link to it as the first navigation pointer.
        assert 'href="how-to-read.html"' in html_index, "index missing link to how-to-read.html"
        # Verify cross-references resolved: findings page should link B-02 somewhere.
        assert 'href="subsystems/b02-auth-service.html"' in html_findings, "expected B-02 link in findings.html"
        assert (
            '<h4 class="finding-subsystem-heading" id="auth-service" data-identifier-defined>'
            '<a class="heading-anchor" href="#auth-service" aria-label="Link to Auth Service">§</a>'
            '<a href="subsystems/b02-auth-service.html">Auth Service</a></h4>'
        ) in html_findings
        # The finding record presents the columns the finding table used to carry:
        # status and revision as facts, the symptom as its lede, then the labelled fields.
        finding_facts = re.findall(r"<dt>([^<]*)</dt>", html_findings.split('<article class="record record-finding"', 1)[1].split("</header>", 1)[0])
        assert finding_facts == ["Status", "Revision"], finding_facts
        assert '<p class="record-lede">Unvalidated query params reach SQL</p>' in html_findings
        assert re.findall(r'<p class="record-label">([^<]*)</p>', html_findings) == ["Why it matters", "Root cause", "Evidence at"]
        # The attached evidence is where the card says it points, with its role.
        evidence_at = html_findings.split('<p class="record-label">Evidence at</p>', 1)[1].split("</div>", 1)[0]
        assert "(root cause)" in evidence_at and "<code>" in evidence_at, evidence_at
        assert "<dt>Subsystem</dt>" not in html_findings
        # Concerns page should link CC-1 as an anchor target.
        assert '<span id="cc-1" class="record-anchor"></span>' in html_concerns
        assert html_checklist.split('id="active-concerns"', 1)[1].count('class="record record-concern-checklist"') == 3
        # The checklist's columns: code, category and territory in the family heading and the
        # record title, the probe, and the subsystems to review it in.
        for column in (
            'href="concerns.html#cc-1">concern CC-1</a>',
            '<span>Cache coherence</span><span class="concern-territory">T2</span>',
            '<div class="record-probe">Does the scheduler retain stale authorization state after a policy change?</div>',
            "<dt>Review in</dt>",
        ):
            assert column in html_checklist, column
        # The contradictions page should exist and say what it now carries.
        # §7.1 titles it Settled conflicts and narrows it to the
        # disagreements the evidence settled; the unresolved ones are on
        # the disagreements page.
        contradictions = (docs / "contradictions.html").read_text()
        assert "<h1>Settled conflicts</h1>" in contradictions
        assert 'href="disagreements.html"' in contradictions
        # Diagnosticity matrix page should exist and contain the cell legend.
        matrix_files = list((docs / "diagnosticity").glob("dm-*.html")) if (docs / "diagnosticity").is_dir() else []
        assert matrix_files, "expected at least one diagnosticity matrix page"
        matrix_body = outline(matrix_files[0].read_text())
        assert "Cell legend" in matrix_body

        # Second run — nothing should be rendered (all sources unchanged).
        summary2 = run_materializer(storage)
        print("run 2:", json.dumps(summary2, indent=2))
        assert summary2["ok"] is True
        assert summary2["pages_rendered"] == 0, f"expected 0 re-renders, got {summary2['pages_rendered']}"
        assert summary2["pages_unchanged"] == summary1["pages_total"], summary2
        assert summary2["xref_updates"] == 0, summary2
        assert summary2["html_pages_rendered"] == 0, summary2
        assert summary2["html_pages_unchanged"] == summary1["html_pages_total"], summary2

        # Third run — replace the entry-point import (withdraw it, import the
        # updated text); only the page that prints it should re-render, plus
        # any page whose cross-reference resolution changed.
        #
        # Ceiling (PAGES_RENDERED_FOR_SINGLE_PROSE_CHANGE): replacing one
        # import should re-render a small constant number of pages, not a
        # fraction of the whole site. The actual affected set is
        # entry-point.md alone: the overview prints the project's purpose, a
        # record of its own, and no longer sources the entry point's file. We
        # allow a generous slop of 4 to cover legitimate cases (e.g. a page
        # whose xref table changed because the text added a new ID). A ceiling
        # above 4 would indicate the diff check is broken and everything is
        # being re-rendered on every run.
        db = sqlite3.connect(storage / "memory.db")
        withdraw_import(db, "entry-point.md", session_id="s1")
        import_body(
            db,
            "entry-point-updated.md",
            "entry-point",
            "# Entry point\n\nUpdated text. This is a fictional test codebase.\n",
            session_id="s1",
            ref_sha="deadbeef",
        )
        db.commit()
        db.close()
        summary3 = run_materializer(storage)
        print("run 3:", json.dumps(summary3, indent=2))
        assert summary3["pages_rendered"] >= 1, summary3  # entry-point
        assert summary3["pages_rendered"] <= 4, (
            f"diff-aware regression: touching one prose file re-rendered "
            f"{summary3['pages_rendered']} pages; expected ≤4. Check the "
            f"materializer's source-hash manifest and cross-reference "
            f"invalidation logic."
        )
        assert 1 <= summary3["html_pages_rendered"] <= 4, summary3

        # DB-change regression guard: flip one disposition's classification
        # and verify only the affected subsystem's survey page plus the
        # aggregate pages re-render. This is the most common agent
        # operation (one set_disposition call mid-survey); a regression
        # that caused it to re-render every subsystem page would make the
        # conspectus unusable at scale.
        #
        # Ceiling (PAGES_RENDERED_FOR_SINGLE_DB_CHANGE): the change touches
        # exactly one disposition row. Pages affected:
        #   - subsystems/b01-…md (the subsystem whose disposition changed)
        #   - concerns.md        (coverage heatmap)
        #   - index.md           (dashboard stats)
        # Everything else reads independently of this cell. Budget is 6 to
        # leave headroom for legitimate expansions (e.g. a findings page
        # that picks up changed evidence roles).
        db = sqlite3.connect(storage / "memory.db")
        db.execute(
            "UPDATE dispositions SET classification = 'confirmed-bug' "
            "WHERE subsystem_id = 'B-01' AND concern_code = 'CC-1'"
        )
        db.commit()
        db.close()
        summary_db = run_materializer(storage)
        print("db change:", json.dumps(summary_db, indent=2))
        assert summary_db["pages_rendered"] >= 1, summary_db
        assert summary_db["pages_rendered"] <= 6, (
            f"diff-aware regression: changing one disposition re-rendered "
            f"{summary_db['pages_rendered']} pages; expected ≤6. This would "
            f"make the materializer unusable at full-codebase scale — "
            f"investigate which pages' source hashes changed unexpectedly."
        )

        # Fourth run — add a new subsystem; old pages unchanged, new page
        # appears, and cross-refs on existing pages may update.
        db = sqlite3.connect(storage / "memory.db")
        db.execute(
            "INSERT INTO subsystems (id, name, status, layer) VALUES ('B-03', 'Rate limiter', 'unmapped', 'backend')"
        )
        db.commit()
        db.close()
        summary4 = run_materializer(storage)
        print("run 4:", json.dumps(summary4, indent=2))
        assert summary4["pages_total"] == summary1["pages_total"] + 1  # new subsystem page
        assert "Rate limiter" in (docs / "subsystems/b03-rate-limiter.html").read_text()
        assert (docs / "subsystems/b03-rate-limiter.html").is_file()

        # Fifth run — remove B-03; the page and its manifest entry should be retired.
        db = sqlite3.connect(storage / "memory.db")
        db.execute("DELETE FROM subsystems WHERE id = 'B-03'")
        db.commit()
        db.close()
        summary5 = run_materializer(storage)
        print("run 5:", json.dumps(summary5, indent=2))
        assert summary5["pages_total"] == summary1["pages_total"], summary5
        assert "Rate limiter" not in (docs / "master-plan.html").read_text()
        assert "subsystems/b03-rate-limiter.html" in summary5["html_pages_retired"]
        assert not (docs / "subsystems/b03-rate-limiter.html").is_file()

        # Sixth scenario — fault injection. A renderer exception should
        # NOT abort the whole run (one bad page shouldn't fail every
        # other page), but MUST propagate to summary.ok=False so the
        # process exit code is non-zero and CI notices. The warning is
        # expected to include a traceback so a typo'd column or missing
        # dict key is immediately legible. Monkey-patching needs
        # in-process import; the subprocess flow above can't do it.
        sys.path.insert(0, str(ROOT))
        import amanuensis_materializer  # noqa: E402 — after path insert
        from amanuensis_materializer import renderers as rmod  # noqa: E402

        def _broken(*_args, **_kwargs):
            raise KeyError("simulated typo: 'finding_idx'")

        original_render_findings = rmod.render_findings
        rmod.render_findings = _broken
        try:
            m = amanuensis_materializer.Materializer(storage=storage, output=storage / "docs")
            fault_summary = m.materialize()
        finally:
            rmod.render_findings = original_render_findings
        print("fault injection:", json.dumps(fault_summary, indent=2))
        assert fault_summary["ok"] is False, fault_summary
        assert any("finding_idx" in w for w in fault_summary["warnings"]), fault_summary
        assert any("Traceback" in w for w in fault_summary["warnings"]), fault_summary
        # Other pages still rendered successfully — one failure doesn't
        # cascade.
        assert fault_summary["pages_total"] > 1, fault_summary

        # B04-1: the staleness map must not convert an unmeasured state into an
        # affirmative freshness claim. `entries` carries the only staleness
        # columns in the schema and no server path writes to it, so the empty
        # branch is the only branch that ever renders in a real project. An
        # empty result means "nothing was measured", not "nothing is stale".
        from amanuensis_materializer import diagrams as dmod  # noqa: E402

        def staleness(db: sqlite3.Connection) -> str:
            """The staleness section's body as text: its sentence, or `id : count` per bar."""

            from amanuensis_materializer.page import Paragraph, StalenessBars  # noqa: E402

            (block,) = dmod.staleness_blocks(db)
            if isinstance(block, StalenessBars):
                return "\n".join(f"{label} : {value:g}" for label, value in block.values)
            assert isinstance(block, Paragraph), block
            return block.text.plain

        staleness_db = sqlite3.connect(storage / "memory.db")
        try:
            unmeasured = staleness(staleness_db)
            assert "is fresh" not in unmeasured, (
                "staleness map claims freshness from an empty source: " + unmeasured
            )
            assert "no staleness data" in unmeasured.lower(), unmeasured

            staleness_db.execute(
                "INSERT INTO file_ledger (subsystem_id, file_path, classification, ref_sha, "
                "stale, stale_reason) VALUES ('B-01', 'src/core.ts', 'examined', 'abc1234', 1, "
                "'git-drift')"
            )
            staleness_db.commit()
            measured = staleness(staleness_db)
            assert "B-01" in measured, measured

            # An exempt row that has drifted must not appear as an obligation.
            staleness_db.execute(
                "INSERT INTO file_ledger (subsystem_id, file_path, classification, ref_sha, "
                "stale, stale_reason) VALUES ('B-04', 'docs/report.html', 'generated-ignore', "
                "'abc1234', 1, 'git-drift')"
            )
            staleness_db.commit()
            mixed = staleness(staleness_db)
            assert "B-04" not in mixed, mixed
            assert "B-01" in mixed, mixed

            staleness_db.execute("UPDATE file_ledger SET stale = 0 WHERE file_path = 'src/core.ts'")
            staleness_db.commit()
            measured_clean = staleness(staleness_db)
            # A clean result must still carry the denominator it was measured
            # against, so "nothing stale" cannot be read as "nothing checked".
            assert "no stale files across 1 scoped file" in measured_clean.lower(), measured_clean
            assert "no staleness data" not in measured_clean.lower(), measured_clean
        finally:
            staleness_db.close()
        print("staleness map: unmeasured, stale, and measured-clean states distinguished")

        # nest_headings (legacy_prose) shifts a survey artifact's headings beneath the page
        # section it is rendered inside (§3.4, §9.1).  It must move headings and
        # nothing else: a `#` inside a fenced code block is content the survey
        # recorded, and rewriting it changes bytes the reader is told are
        # verbatim.  Tracking only the backtick fence let the tilde form
        # through (slice-S3, F10/codex).
        lmod = __import__("amanuensis_materializer.legacy_prose", fromlist=["legacy_prose"])
        nest = lmod.nest_headings
        cases = [
            ("~~~text\n# literal code heading\n~~~", "~~~text\n# literal code heading\n~~~"),
            ("```text\n# literal code heading\n```", "```text\n# literal code heading\n```"),
            ("~~~~\n~~~\n# inside the longer fence\n~~~~", "~~~~\n~~~\n# inside the longer fence\n~~~~"),
            ("```\n~~~\n# inside the backtick fence\n```", "```\n~~~\n# inside the backtick fence\n```"),
            # …while a heading outside every fence still moves.
            ("# survey title\n~~~\n# not a heading\n~~~\n## after", "#### survey title\n~~~\n# not a heading\n~~~\n##### after"),
        ]
        for source, expected in cases:
            got = nest(source, 3)
            assert got == expected, f"nest_headings({source!r}) -> {got!r}, wanted {expected!r}"
        print("nested prose: headings move, fenced content of either fence character does not")

        print("\nOK — all diff-aware behaviors verified.")


if __name__ == "__main__":
    main()
