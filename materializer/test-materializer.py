#!/usr/bin/env python3
"""End-to-end test: seed a temp conspectus, materialize it, verify output.

Runs twice to exercise diff-aware behavior: the second run should
re-render almost nothing.
"""
from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCHEMA = ROOT.parent / "mcp-server" / "src" / "schema.sql"


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
        # Write two prose artifacts to prove passthrough works.
        (storage / "entry-point.md").write_text(
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
        (storage / "onboarding-report.md").write_text(
            "# Onboarding report\n\n**Codebase**: FictionalProject — materializer fixture\n\n"
            "## Directory clusters\n\n- scheduler/ — B-01\n- auth/ — B-02\n- web/ — F-01\n"
        )
        (storage / "workspace_path").write_text("/example/FictionalProject\n")
        db = sqlite3.connect(storage / "memory.db")
        seed(db)
        db.close()

        # First run — should render everything.
        summary1 = run_materializer(storage)
        print("run 1:", json.dumps(summary1, indent=2))
        assert summary1["ok"] is True, summary1
        assert summary1["html_entrypoint"] == str((storage / "docs" / "index.html").resolve())
        assert summary1["pages_rendered"] > 0
        assert summary1["pages_unchanged"] == 0, summary1
        # Verify key pages exist.
        docs = storage / "docs"
        for p in [
            "index.md", "architecture.md", "master-plan.md", "findings.md",
            "concerns.md", "seams.md", "contradictions.md", "diagnosticity.md",
            "vocabulary.md", "field-notes.md", "entry-point.md", "onboarding-report.md",
            "how-to-read.md",
            "subsystems/b01-job-scheduler.md", "subsystems/b02-auth-service.md",
            "subsystems/f01-web-ui.md",
        ]:
            assert (docs / p).is_file(), f"missing: {p}"
            html_page = str(Path(p).with_suffix(".html"))
            assert (docs / html_page).is_file(), f"missing HTML companion: {html_page}"
        html_index = (docs / "index.html").read_text()
        assert "Amanuensis HTML projection" in html_index
        assert "FictionalProject" in html_index
        assert "Architecture survey · Amanuensis" in html_index
        assert 'aria-label="FictionalProject report navigation"' in html_index
        assert "Find a page" in html_index
        assert "Reading hint" not in html_index
        assert "Living architecture" not in html_index
        assert "--paper" not in html_index and "Iowan Old Style" in html_index
        assert "--accent: #235b58" in html_index
        assert "column-count: 2" in html_index and "column-count: 3" in html_index
        assert "--page: 128rem" in html_index
        assert "@container report (min-width: 120ch)" in html_index
        assert "@container report (min-width: 190ch)" in html_index
        assert "@media (min-width: 1180px)" not in html_index
        assert ".page-hint { max-width: none" in html_index
        assert "border-radius: 999px" not in html_index
        assert ".js .nav-rail" in html_index, "mobile drawer must be enhancement-only"
        assert "navRail.inert" in html_index, "closed enhanced drawer must leave the tab order"
        assert "setMenuOpen(false, true)" in html_index, "Escape must close the drawer and restore focus"
        assert 'href="findings.html"' in html_index
        assert "https://" not in html_index, "HTML shell must not depend on a remote asset"
        html_findings = (docs / "findings.html").read_text()
        assert 'href="subsystems/b02-auth-service.html"' in html_findings
        assert "status-open" in html_findings
        assert 'class="record-list record-list-finding"' in html_findings
        assert 'class="record record-finding"' in html_findings
        assert 'class="record-lede"' in html_findings and "Root cause" in html_findings
        html_concerns = (docs / "concerns.html").read_text()
        assert 'class="identifier-definition"' in html_concerns
        assert 'title="CC-1 — Cache Coherence"' in html_concerns
        assert 'aria-label="CC-1 — Cache Coherence"' in html_concerns
        assert 'class="severity severity-high"' in html_findings
        assert "<table" not in html_findings and "<p>|" not in html_findings
        html_entry = (docs / "entry-point.html").read_text()
        assert 'class="record-list record-list-file-ledger"' in html_entry
        assert "scheduler/main.ts" in html_entry and "Why this file is in scope" in html_entry
        assert 'class="table-wrap lifecycle-table"' in html_entry
        assert "Location: " in html_entry and "JobQueue" in html_entry
        assert 'class="summary-list"' in html_entry and "Native memory" in html_entry
        html_master_plan = (docs / "master-plan.html").read_text()
        assert 'class="record-list record-list-subsystem"' in html_master_plan
        assert 'title="B-01 — Job Scheduler"' in html_master_plan
        html_b02 = (docs / "subsystems/b02-auth-service.html").read_text()
        assert 'class="record-list record-list-concern-disposition"' in html_b02
        html_architecture = (docs / "architecture.html").read_text()
        assert '<div class="topology topology-dependency"' in html_architecture
        assert '<div class="topology topology-seam"' in html_architecture
        assert "jobs_queue" in html_architecture and "Connected area" in html_architecture

        # A nodes-only dependency source must fail closed into a linked layer
        # atlas rather than exposing raw Mermaid or implying edges.
        from amanuensis_materializer.diagrams import subsystem_dependency_graph
        from amanuensis_materializer.html_projection import MarkdownRenderer

        atlas_db = sqlite3.connect(storage / "memory.db")
        atlas_db.execute("DELETE FROM xrefs")
        atlas_markdown = subsystem_dependency_graph(atlas_db)
        atlas_db.rollback()
        atlas_db.close()
        _, atlas_body = MarkdownRenderer({}, "architecture.html").render(
            "# Architecture\n\n## Subsystem atlas\n\n" + atlas_markdown
        )
        assert 'class="subsystem-atlas"' in atlas_body
        assert "not an inferred dependency graph" in atlas_body
        assert "<table" not in atlas_body and "Diagram source" not in atlas_body

        _, github_ledger = MarkdownRenderer(
            {}, "entry-point.html", repository_url="https://github.com/acme/fictional"
        ).render(
            "# Files\n\n## File ledger\n\n"
            "| Path | Classification | Why in scope | Ref SHA |\n"
            "|---|---|---|---|\n"
            "| `scheduler/main.ts` | examined | Owns dispatch. | `deadbeef` |\n"
        )
        assert 'href="https://github.com/acme/fictional/blob/deadbeef/scheduler/main.ts"' in github_ledger
        long_paragraph = "A precise architectural account remains readable when its evidence and limits stay adjacent. " * 10
        _, column_prose = MarkdownRenderer({}, "entry-point.html").render(
            "# Reading field\n\n## Account\n\n"
            + long_paragraph
            + "\n\n"
            + long_paragraph
        )
        assert '<div class="prose-flow">' in column_prose
        assert column_prose.index(long_paragraph.strip()) < column_prose.rindex(long_paragraph.strip())
        _, humanized_prose = MarkdownRenderer({}, "entry-point.html").render(
            "# Record\n\n## History\n\n"
            "**Concern dispositions** were recorded after **Jump-in reading**."
        )
        assert "Concern review" in humanized_prose and "Start here" in humanized_prose
        assert "Concern dispositions" not in humanized_prose and "Jump-in reading" not in humanized_prose
        # The reader's guide is static — every conspectus ships with it.
        # Sanity-check that the content actually landed.
        htr = (docs / "how-to-read.md").read_text()
        assert "How to read this conspectus" in htr
        assert "knowledge-depth contract" in htr
        assert "evidence quality" in htr.lower()
        assert "\x00" not in htr, "nested xref placeholders leaked into Markdown"
        assert "\x00" not in (docs / "how-to-read.html").read_text(), "xref placeholders leaked into HTML"
        # The index should link to it as the first navigation pointer.
        index = (docs / "index.md").read_text()
        assert "how-to-read.md" in index, "index missing link to how-to-read.md"
        # Verify cross-references resolved: findings page should link B-02 somewhere.
        findings = (docs / "findings.md").read_text()
        assert "](subsystems/b02-auth-service.md)" in findings, "expected B-02 link in findings.md"
        # Concerns page should link CC-1 as an anchor target.
        concerns = (docs / "concerns.md").read_text()
        assert "<a id=\"cc-1\"></a>" in concerns
        # Contradictions page should exist but note there are none currently.
        contradictions = (docs / "contradictions.md").read_text()
        assert "# Contradictions" in contradictions
        # Diagnosticity matrix page should exist and contain the cell legend.
        matrix_files = list((docs / "diagnosticity").glob("dm-*.md")) if (docs / "diagnosticity").is_dir() else []
        assert matrix_files, "expected at least one diagnosticity matrix page"
        matrix_body = matrix_files[0].read_text()
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

        # Third run — touch the entry-point prose; only pages that source
        # from it should re-render (index + entry-point passthrough, plus
        # any page whose cross-reference resolution changed).
        #
        # Ceiling (PAGES_RENDERED_FOR_SINGLE_PROSE_CHANGE): touching one
        # prose file should re-render a small constant number of pages,
        # not a fraction of the whole site. The actual affected set is
        # index.md + entry-point.md; we allow a generous slop of 4 to
        # cover legitimate cases (e.g. a page whose xref table changed
        # because the entry-point added a new ID). A ceiling above 4
        # would indicate the diff check is broken and everything is
        # being re-rendered on every run.
        (storage / "entry-point.md").write_text(
            "# Entry point\n\nUpdated text. This is a fictional test codebase.\n"
        )
        summary3 = run_materializer(storage)
        print("run 3:", json.dumps(summary3, indent=2))
        assert summary3["pages_rendered"] >= 2, summary3  # index + entry-point
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
        assert (docs / "subsystems/b03-rate-limiter.md").is_file()
        assert (docs / "subsystems/b03-rate-limiter.html").is_file()

        # Fifth run — remove B-03; the page and its manifest entry should be retired.
        db = sqlite3.connect(storage / "memory.db")
        db.execute("DELETE FROM subsystems WHERE id = 'B-03'")
        db.commit()
        db.close()
        summary5 = run_materializer(storage)
        print("run 5:", json.dumps(summary5, indent=2))
        assert "subsystems/b03-rate-limiter.md" in summary5["pages_retired"]
        assert not (docs / "subsystems/b03-rate-limiter.md").is_file()
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

        print("\nOK — all diff-aware behaviors verified.")


if __name__ == "__main__":
    main()
