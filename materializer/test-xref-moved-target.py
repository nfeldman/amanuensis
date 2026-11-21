#!/usr/bin/env python3
"""A link on an unchanged page follows its target when the target moves.

A beta tester's publish rendered every page and was marked failed: a finding
had been verified fixed, so its record moved from findings to
resolved-findings, but the leads page still linked findings#<id>. The
leads page's own sources had not changed, so the materializer kept last run's
file, and the cross-reference pass leaves an ID that is already inside a link
alone. This test publishes with the finding open, resolves it, publishes again
and reads the leads page's link.
"""
from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("fixture", ROOT / "test-materializer.py")
assert spec and spec.loader
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

failed = 0


def check(label: str, problem: str | None) -> None:
    global failed
    if problem:
        failed += 1
        print(f"  FAIL {label}: {problem}")
    else:
        print(f"  ok   {label}")


class LinkTexts(HTMLParser):
    """Every link's target with the visible text it carries."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self._href = next((v or "" for k, v in attrs if k == "href"), "")
            self._text = ""

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._href is not None:
            self.links.append((self._href, self._text.strip()))
            self._href = None

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text += data


def leads_link(docs: Path) -> str | None:
    parser = LinkTexts()
    parser.feed((docs / "field-notes.html").read_text())
    targets = {href for href, text in parser.links if text == "B02-1"}
    for target in ("resolved-findings.html#b02-1", "findings.html#b02-1"):
        if target in targets:
            return target
    return None


SENTINEL = "not-re-rendered-sentinel"


def rendered_at(docs: Path, set_to: str | None = None) -> str | None:
    """Read the leads page's manifest timestamp, or replace it with `set_to`.

    The timestamp has one-second precision, so two renders inside one second
    look alike; the test plants a sentinel instead and checks it survives.
    """
    path = docs / ".manifest.json"
    manifest = json.loads(path.read_text())
    for page in manifest.get("pages", []):
        if page.get("path") == "field-notes.md":
            if set_to is not None:
                page["rendered_at"] = set_to
                path.write_text(json.dumps(manifest))
            return page.get("rendered_at")
    return None


def main() -> int:
    with tempfile.TemporaryDirectory() as td:
        storage = Path(td)
        db = sqlite3.connect(storage / "memory.db")
        fixture.seed(db)
        db.execute(
            "INSERT INTO field_notes (category, observation, location, ref_sha, session_id, follow_up)"
            " VALUES ('anomaly', 'The gateway defect B02-1 also reaches the retry path', 'auth/gateway.ts',"
            " 'deadbeef', 's1', 'open')"
        )
        db.commit()
        docs = storage / "docs"

        fixture.run_materializer(storage)
        planted = rendered_at(docs, set_to=SENTINEL)
        first = leads_link(docs)
        check(
            "an open finding is linked on findings.html",
            None if first == "findings.html#b02-1" else f"the leads page links {first!r}",
        )

        evidence = db.execute(
            "INSERT INTO evidence (file_path, symbol, ref_sha, kind, note)"
            " VALUES ('auth/gateway.ts', 'parse', 'deadbeef', 'code-verified', 'fix verified')"
        ).lastrowid
        db.execute(
            "INSERT INTO finding_evidence (finding_id, evidence_id, role) VALUES ('B02-1', ?, 'fix-verification')",
            (evidence,),
        )
        db.execute(
            "INSERT INTO finding_resolution_events (finding_id, resolution_state, fix_location, fix_sha,"
            " evidence_id, rationale, session_id)"
            " VALUES ('B02-1', 'verified-fixed', 'auth/gateway.ts:parse', 'deadbeef', ?, 'fixture', 's1')",
            (evidence,),
        )
        db.commit()
        db.close()

        fixture.run_materializer(storage)
        check(
            "the leads page's own sources did not change, so it was not re-rendered",
            None
            if planted == SENTINEL and rendered_at(docs) == SENTINEL
            else "the leads page was re-rendered, so the stale-link path was not exercised",
        )
        second = leads_link(docs)
        check(
            "once resolved, the same link points at resolved-findings.html",
            None if second == "resolved-findings.html#b02-1" else f"the leads page links {second!r}",
        )
        html = (docs / "field-notes.html").read_text() if (docs / "field-notes.html").is_file() else ""
        check(
            "the HTML leads page follows it",
            None
            if 'href="findings.html#b02-1"' not in html and "resolved-findings.html#b02-1" in html
            else "field-notes.html still links findings.html#b02-1 or lacks the resolved link",
        )

    print(f"moved xref targets: {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
