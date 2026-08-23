#!/usr/bin/env python3
"""Fault-injection tests for state/coverage/content projection read-back."""

from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

from amanuensis_materializer.readback import finding_marker

ROOT = Path(__file__).resolve().parent
SCHEMA = ROOT.parent / "mcp-server" / "src" / "schema.sql"


def run(storage: Path, *args: str, expect: int = 0) -> dict:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage), *args],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == expect, (proc.returncode, proc.stdout, proc.stderr)
    return json.loads([line for line in proc.stdout.splitlines() if line][-1])


def seed(storage: Path) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    db.execute("INSERT INTO sessions (session_id, intent) VALUES ('readback', 'fixture')")
    db.execute("INSERT INTO subsystems (id, name, status) VALUES ('B-01', 'Reader', 'concerns')")
    db.execute(
        """INSERT INTO findings
             (finding_id, subsystem_id, symptom, root_cause, severity, status,
              ref_sha, session_id, pass_type)
           VALUES ('B01-1', 'B-01', 'projection can drift', 'no read-back',
                   'HIGH', 'confirmed-bug', 'fixture', 'readback', 'survey')"""
    )
    db.execute(
        """INSERT INTO finding_resolution_events
             (finding_id, resolution_state, rationale, session_id)
           VALUES ('B01-1', 'open', 'fixture', 'readback')"""
    )
    db.execute(
        """INSERT INTO entries
             (id, tier, subsystem_id, source_path, content_hash, ref_sha,
              confidence, stale, stale_since, stale_reason)
           VALUES ('B-01-overview', 1, 'B-01', 'survey.md', 'hash', 'fixture',
                   'verified', 1, datetime('now'), 'fixture-drift')"""
    )
    db.commit()
    db.close()


def assert_axes(summary: dict, *, state: bool, coverage: bool, content: bool) -> None:
    axes = summary["axes"]
    assert axes["state"]["ok"] is state, summary
    assert axes["coverage"]["ok"] is coverage, summary
    assert axes["content"]["ok"] is content, summary


def main() -> None:
    with tempfile.TemporaryDirectory() as td:
        storage = Path(td)
        seed(storage)
        docs = storage / "docs"

        clean = run(storage, "--clean-publish")
        assert clean["ok"] and clean["published"], clean
        assert clean["html_entrypoint"] == str((docs / "index.html").resolve())
        assert_axes(clean["readback"], state=True, coverage=True, content=True)

        # A clean-directory transaction owns only manifest-listed files. It
        # must not erase a human file merely because it sits beside the docs.
        human_file = docs / "human-notes.md"
        human_file.write_text("do not replace\n")
        refused = run(storage, "--clean-publish", expect=2)
        assert refused["published"] is False and "unmanaged" in refused["error"], refused
        assert human_file.read_text() == "do not replace\n"
        human_file.unlink()

        # VP4 red arm 1: remove one durable finding marker.  State and byte
        # correspondence fail; link coverage remains intact.
        findings = docs / "findings.md"
        body = findings.read_text()
        marker_line = next(line for line in body.splitlines() if "amanuensis:finding:" in line)
        findings.write_text(body.replace(marker_line + "\n", "", 1))
        missing_finding = run(storage, "--readback-only", expect=1)
        assert missing_finding["published"] is False
        assert_axes(missing_finding, state=False, coverage=True, content=False)
        assert any(
            m["axis"] == "state" and m["object_type"] == "finding"
            for m in missing_finding["mismatches"]
        )

        # A clean publish is the repair path: regenerate from durable truth,
        # verify in staging, then promote.  It never mutates source rows to
        # agree with the corrupt projection.
        repaired = run(storage, "--clean-publish")
        assert repaired["ok"] and repaired["published"], repaired

        # VP4 red arm 2: strip a rendered subsystem cross-link while retaining
        # the finding marker and all pages.  Coverage owns the diagnostic.
        body = findings.read_text()
        target = "subsystems/b01-reader.md"
        assert target in body, body
        findings.write_text(body.replace(f"[B-01]({target})", "B-01", 1))
        missing_link = run(storage, "--readback-only", expect=1)
        assert_axes(missing_link, state=True, coverage=False, content=False)
        assert any(
            m["axis"] == "coverage" and m["object_type"] == "cross-link"
            for m in missing_link["mismatches"]
        )

        run(storage, "--clean-publish")

        # VP4 red arm 3: a stale-state marker is state correspondence, not a
        # link/page coverage question.
        index = docs / "index.md"
        body = index.read_text()
        stale_line = next(line for line in body.splitlines() if "amanuensis:stale-entry:" in line)
        index.write_text(body.replace(stale_line + "\n", "", 1))
        missing_stale = run(storage, "--readback-only", expect=1)
        assert_axes(missing_stale, state=False, coverage=True, content=False)
        assert any(
            m["axis"] == "state" and m["object_type"] == "stale-entry"
            for m in missing_stale["mismatches"]
        )

        run(storage, "--clean-publish")

        # HTML is independently accountable. A healthy Markdown companion
        # must not mask a marker removed from the primary reading surface.
        findings_html = docs / "findings.html"
        body = findings_html.read_text()
        marker = finding_marker("B01-1")
        assert marker in body
        findings_html.write_text(body.replace(marker, "", 1))
        missing_html_finding = run(storage, "--readback-only", expect=1)
        assert_axes(missing_html_finding, state=False, coverage=True, content=False)
        assert any(
            m["axis"] == "state" and m["object_type"] == "finding-html"
            for m in missing_html_finding["mismatches"]
        )

        run(storage, "--clean-publish")

        # The HTML route graph is checked separately from Markdown links.
        body = findings_html.read_text()
        html_target = "subsystems/b01-reader.html"
        assert html_target in body, body
        findings_html.write_text(body.replace(f'href="{html_target}"', 'href="missing.html"', 1))
        missing_html_link = run(storage, "--readback-only", expect=1)
        assert_axes(missing_html_link, state=True, coverage=False, content=False)
        assert any(
            m["axis"] == "coverage" and m["object_type"] == "cross-link"
            for m in missing_html_link["mismatches"]
        )

        print(
            "OK — Markdown and HTML read-back turn red on independent state, coverage, and content faults"
        )


if __name__ == "__main__":
    main()
