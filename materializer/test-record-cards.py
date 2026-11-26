#!/usr/bin/env python3
"""Gate: a record card prints what the store holds for it, and nothing empty.

Owner request, 2026-11-25: the Review coverage page drew every concern as a card
with an empty body, because the card read only `notes` and the survey records a
concern's substance in `probe` and `territory`. The same pass found sibling
gaps, each held here:

  - a concern card prints its territory (with the territory's name) and its
    probe under "What to check"; it prints no "Discovered in" fact when the
    concern was seeded, and its heading is the bare code, not "concern CC-1";
  - the checklist's territory table has a Condition column only when some
    territory records a condition, never a column of dashes;
  - a probe prints as written (a pipe stays a pipe), and a store from before
    concerns carried a territory and a probe still publishes its cards.

Finding and concern-review evidence ("Evidence at") is held by
test-materializer.py, whose fixture attaches evidence to both.

Output protocol: exactly one status line, last, on stdout.
"""

from __future__ import annotations

import json
import re
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCHEMA = ROOT.parent / "mcp-server" / "src" / "schema.sql"
SHA = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"
PROBE = "Check that PROBEMARKER keys every cached parse by (blob | extractor)."

FAILURES: list[str] = []


def check(label: str, reason: str | None) -> None:
    if reason:
        FAILURES.append(f"{label}: {reason}")
        print(f"  FAIL {label}: {reason}")
    else:
        print(f"  ok   {label}")


def seed(storage: Path, *, conditioned: bool, legacy: bool = False) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    db.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha, last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', ?, ?, '2026-11-25T12:00:00Z')",
        (SHA, SHA),
    )
    db.execute("INSERT INTO sessions (session_id, intent) VALUES ('rc', 'fixture')")
    db.execute(
        "INSERT INTO subsystems (id, name, status, layer, scope) VALUES ('B-01', 'Reader', 'mapped', 'backend', 'src/r.ts')"
    )
    db.executemany(
        "INSERT INTO concerns (code, category, origin, status, territory, probe) VALUES (?, ?, 'seeded', 'active', ?, ?)",
        [("CC-1", "cache-coherence", "T2", PROBE), ("CB-1", "concurrency", None, None)],
    )
    territories = [("T2", "applies", None)]
    if conditioned:
        territories.append(("T8", "disqualified", "CONDITIONMARKER: one process, one thread"))
    db.executemany(
        "INSERT INTO territory_dispositions (territory, disposition, condition, ref_sha, session_id) VALUES (?, ?, ?, ?, 'rc')",
        [(t, d, c, SHA) for t, d, c in territories],
    )
    if legacy:
        # A store from before the calibrated checklist: no territory or probe column.
        db.execute("ALTER TABLE concerns DROP COLUMN probe")
        db.execute("ALTER TABLE concerns DROP COLUMN territory")
    db.commit()
    db.close()


def publish(storage: Path) -> str | None:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage)],
        capture_output=True,
        text=True,
        check=False,
    )
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    try:
        summary = json.loads(lines[-1]) if lines else {}
    except json.JSONDecodeError:
        summary = {}
    if proc.returncode != 0 or summary.get("ok") is False:
        return f"the fixture did not publish (exit {proc.returncode}): {proc.stderr[-200:]}"
    return None


def card(page: str, code: str) -> str:
    match = re.search(
        rf'<article class="record record-concern"[^>]*aria-labelledby="concern-{code.lower()}".*?</article>', page, re.S
    )
    return match.group(0) if match else ""


def territory_header(page: str) -> list[str]:
    table = re.search(r"<caption>territories</caption>.*?</thead>", page, re.S | re.I)
    return re.findall(r"<th\b[^>]*>(.*?)</th>", table.group(0)) if table else []


def territory_rows(page: str) -> list[int]:
    """The number of cells in each row of the territory table."""

    table = re.search(r"<caption>territories</caption>.*?</table>", page, re.S | re.I)
    body = re.search(r"<tbody\b.*?</tbody>", table.group(0), re.S) if table else None
    trs = re.findall(r"<tr\b[^>]*>(.*?)</tr>", body.group(0), re.S) if body else []
    return [len(re.findall(r"<td\b", tr)) for tr in trs]


def main() -> int:
    print("GATE record cards — a card prints what the store holds, nothing empty")
    with tempfile.TemporaryDirectory(prefix="record-cards-") as tmp:
        legacy = Path(tmp) / "legacy"
        legacy.mkdir()
        try:
            seed(legacy, conditioned=False, legacy=True)
            failed = publish(legacy)
            if not failed and "CC-1" not in (legacy / "docs" / "concerns.html").read_text():
                failed = "concerns.html carries no card for CC-1"
        except sqlite3.Error as exc:
            failed = f"the legacy fixture could not be seeded: {exc}"
        check("a store without territory and probe columns publishes its concern cards", failed)
        for conditioned in (False, True):
            storage = Path(tmp) / ("conditioned" if conditioned else "plain")
            storage.mkdir()
            seed(storage, conditioned=conditioned)
            failed = publish(storage)
            check(f"the {'conditioned' if conditioned else 'plain'} fixture publishes", failed)
            if failed:
                continue
            docs = storage / "docs"
            concerns = (docs / "concerns.html").read_text()
            checklist = (docs / "concern-checklist.html").read_text()
            header = territory_header(checklist)
            if conditioned:
                check(
                    "a recorded condition keeps the Condition column, a cell in every row",
                    None
                    if header == ["Territory", "Disposition", "Condition"]
                    and "CONDITIONMARKER" in checklist
                    and territory_rows(checklist) == [3, 3]
                    else f"territory table headed {header!r}, rows of {territory_rows(checklist)} cells",
                )
                continue
            check(
                "no territory records a condition: no Condition column",
                None
                if header == ["Territory", "Disposition"] and territory_rows(checklist) == [2]
                else f"territory table headed {header!r}, rows of {territory_rows(checklist)} cells",
            )
            cc1, cb1 = card(concerns, "CC-1"), card(concerns, "CB-1")
            check("each concern has a card", None if cc1 and cb1 else "a concern card is missing")
            check(
                "a concern card prints its probe under What to check",
                None
                if '<p class="record-label">What to check</p>' in cc1 and "(blob | extractor)" in cc1
                else "CC-1's card has no What to check field with its probe as written",
            )
            check(
                "a concern card names its territory",
                None
                if re.search(r"<dt>Territory</dt><dd>T2 \(Cache Coherence Failure\)</dd>", cc1)
                else "CC-1's card has no Territory fact naming T2",
            )
            check(
                "an empty fact or field is left out",
                None
                if "Discovered in" not in concerns
                and "<dt>Territory</dt>" not in cb1
                and "What to check" not in cb1
                and "<dd>—</dd>" not in cc1 + cb1
                else "a card prints an empty fact or field",
            )
            check(
                "a concern code heading its own card is not prefixed",
                None if ">concern <abbr" not in concerns and "concern concern" not in concerns else "a heading reads 'concern CC-1'",
            )
    if FAILURES:
        print(f"GATE record cards RED: {FAILURES[0][:230]}")
        return 1
    print("GATE record cards GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
