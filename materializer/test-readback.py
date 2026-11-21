#!/usr/bin/env python3
"""Fault-injection tests for state/coverage/content projection read-back."""

from __future__ import annotations

import json
import re
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
        """INSERT INTO file_ledger
             (subsystem_id, file_path, why_in_scope, classification, ref_sha,
              stale, stale_since, stale_reason)
           VALUES ('B-01', 'src/reader.ts', 'fixture', 'examined', 'fixture',
                   1, datetime('now'), 'git-drift')"""
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
        human_file = docs / "human-notes.txt"
        human_file.write_text("do not replace\n")
        refused = run(storage, "--clean-publish", expect=2)
        assert refused["published"] is False and "unmanaged" in refused["error"], refused
        assert human_file.read_text() == "do not replace\n"
        human_file.unlink()

        # VP4 red arm 1: remove one durable finding marker.  State and byte
        # correspondence fail; link coverage remains intact.
        findings = docs / "findings.html"
        body = findings.read_text()
        marker_comment = re.search(r"<!-- amanuensis:finding:[^>]*-->", body)
        assert marker_comment, body
        findings.write_text(body.replace(marker_comment.group(0), "", 1))
        missing_finding = run(storage, "--readback-only", expect=1)
        assert missing_finding["published"] is False
        assert_axes(missing_finding, state=False, coverage=True, content=False)
        assert any(
            m["axis"] == "state" and m["object_type"] == "finding-html"
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
        target = "subsystems/b01-reader.html"
        assert target in body, body
        target_link = re.compile(rf'<a\b[^>]*href="{re.escape(target)}"[^>]*>(.*?)</a>', re.S)
        assert target_link.search(body), body
        findings.write_text(target_link.sub(r"\1", body, count=1))
        missing_link = run(storage, "--readback-only", expect=1)
        assert_axes(missing_link, state=True, coverage=False, content=False)
        assert any(
            m["axis"] == "coverage" and m["object_type"] == "cross-link"
            for m in missing_link["mismatches"]
        )

        run(storage, "--clean-publish")

        # VP4 red arm 3: a stale-state marker is state correspondence, not a
        # link/page coverage question.
        stale_page = docs / "stale.html"
        body = stale_page.read_text()
        stale_marker = re.search(r"<!-- amanuensis:ledger-stale:[^>]*-->", body)
        assert stale_marker, body
        stale_page.write_text(body.replace(stale_marker.group(0), "", 1))
        missing_stale = run(storage, "--readback-only", expect=1)
        assert_axes(missing_stale, state=False, coverage=True, content=False)
        assert any(
            m["axis"] == "state" and m["object_type"] == "ledger-stale-html"
            for m in missing_stale["mismatches"]
        ), missing_stale["mismatches"]

        run(storage, "--clean-publish")

        # HTML is independently accountable: a marker removed from the
        # primary reading surface is a state fault in its own right.
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

        # The HTML route graph: a link retargeted at a page that does not exist.
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
            "OK — HTML read-back turns red on independent state, coverage, and content faults"
        )


if __name__ == "__main__":
    main()
