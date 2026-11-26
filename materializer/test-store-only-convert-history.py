#!/usr/bin/env python3
"""Gate for store-only packet SO17 — the History pages are built as page models
(design/store-only/PLAN.md §3.1, §3.2 step 4, §3.4, §8 SO17).

The family is `resolved-findings`, `resolution-history`, `resolved-leads`, `sessions`
and `contradictions` (conflicting evidence). Each store fixture of the golden corpus is
rebuilt from its recorded SQL dump into a temporary store and published in this process,
with the Markdown parser instrumented. Four stores are built here from the `lens` dump
plus rows the corpus does not hold: a rich one (resolved findings of every state and
basis, carried obligations decided four ways, finding, severity and contradiction events,
settled and standing contradictions, settled questions, closed leads, sessions, refresh
runs and read-backs of every shape), a bare one (every record these pages read removed,
so each page prints its empty state), and two partial ones (questions without leads and
sessions alone; leads without questions and read-backs alone) that reach the sub-sections
the rich store always fills. The tree this packet started from publishes all of them too,
and its HTML is the reference for every page of the family.

Turns red when:

  - the golden corpus is absent, or one of its stores lacks a family page;
  - a family page of a rebuilt fixture differs by one byte from the golden HTML;
  - a family page of the rich, bare or partial stores differs by one byte from what the
    packet's start tree publishes for the same store, or any other page of any of them
    differs;
  - the Markdown parser runs while a family page is built, or never runs for any other
    page, so the counter would be blind;
  - a family renderer does not return a `Page` with a title, the page's own path, blocks
    and sources, or a publication is not green on all three read-back axes;
  - a mutated store (a rationale, a session, an event row, an evidence note, a question's
    answer, a lead's observation, a refresh run's provider changed) leaves the family
    page that reads it unchanged, which would show the page is not built from the store;
  - the gate does not run in CI.

False green it cannot exclude: byte identity is proved on four golden stores and four
stores seeded here; a record shape none of them holds could print differently. The
parser stays in the tree until SO19, which is what makes the comparison possible.

Output protocol: exactly one status line, last, on stdout. Every message is scrubbed,
so a missing deliverable reports as an assertion failure and not as a crash.
"""

from __future__ import annotations

import contextlib
import importlib
import io
import json
import re
import sqlite3
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from typing import Any

import lineage_style  # noqa: E402

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
GOLDEN = ROOT / "fixtures" / "store-only-golden"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"
START_SHA = "eb537daee3a6f24295a3755e6b41350f6f8355f7"

# SO20 marks every rendered record and drawn node or edge with these four attributes
# (PLAN §3.5). The start tree predates them, so the current page is compared with
# them removed; SO20's own gate checks their values.
_SO20_MARKS = re.compile(r' data-(?:record|state|node|edge)="[^"]*"')


# SO22 adds a drawn figure to the guide and to each subsystem page (PLAN §3.2's update
# rule); the start tree predates them, so a figure is removed whole as well. SO23 adds more.
_SO22_FIGURES = re.compile(
    # A figure that closes its container takes the newline before it.
    r'\n<figure\b[^>]*data-diagram="[^"]*"[^>]*>(?:(?!</figure>).)*</figure>(?=</)'
    r'|<figure\b[^>]*data-diagram="[^"]*"[^>]*>.*?</figure>\n?'
    # SO23 adds a "not measured" sentence, finding badges and the note under them (PLAN §3.2's update rule).
    r'|\n<p class="(?:diagram-below|finding-badge-note)"[^>]*>(?:(?!</p>).)*</p>(?=</)'
    r'|<p class="(?:diagram-below|finding-badge-note)"[^>]*>(?:(?!</p>).)*</p>\n?'
    r'|<div class="atlas-badges"[^>]*>.*?</div>'
    r'|<g class="boundary-svg-badge"[^>]*>.*?</g>',
    re.S,
)

# SO24 adds sentences and figures to the Boundaries page; taking them out can leave the
# wrapper that held a run of paragraphs empty (PLAN §3.2's update rule).
_EMPTY_FLOW = re.compile(r'<div class="prose-flow">\s*</div>\n?')


def unmarked(text: str) -> str:
    return _EMPTY_FLOW.sub("", _SO20_MARKS.sub("", _SO22_FIGURES.sub("", text)))

FAMILY = ("resolved-findings", "resolution-history", "resolved-leads", "sessions", "contradictions")
STORES = ("materializer", "axiomdb-shaped", "self-shaped", "lens")

_SCRUB: tuple[tuple[str, str], ...] = (
    ("MODULE_NOT_FOUND", "module-absent"),
    ("ModuleNotFoundError", "python-module-absent"),
    ("Cannot find module", "cannot load module"),
    ("No such file or directory", "path is absent"),
    ("No such file", "path is absent"),
    ("can't open file", "cannot open path"),
    ("SyntaxError", "syntax-error"),
    ("ImportError", "python-import-error"),
    ("ReferenceError", "reference-error"),
    ("TypeError", "type-error"),
    ("AttributeError", "attribute-error"),
    ("ENOENT", "PATH-ABSENT"),
    ("is not defined", "is undeclared"),
    ("command not found", "executable is absent"),
    ("Traceback (most recent call last)", "trace follows"),
)


def scrub(text: object) -> str:
    out = "" if text is None else str(text)
    for needle, replacement in _SCRUB:
        out = out.replace(needle, replacement)
    return out


def emit(line: str = "") -> None:
    sys.stdout.write(f"{scrub(line)}\n")


FAILURES: list[str] = []


def check(label: str, fn: Callable[[], str | None]) -> None:
    try:
        reason = fn()
    except Exception as exc:  # the gate must survive any absent deliverable
        reason = f"raised while checking — {exc!r}"
    if reason:
        FAILURES.append(f"{label}: {reason}")
        emit(f"  FAIL {label}: {reason}")
    else:
        emit(f"  ok   {label}")


def load(name: str) -> tuple[Any, str | None]:
    sys.path.insert(0, str(ROOT))
    try:
        return importlib.import_module(f"amanuensis_materializer.{name}"), None
    except Exception as exc:  # absent or broken module: an assertion, not a crash
        return None, f"amanuensis_materializer/{name}.py could not be loaded ({type(exc).__name__}: {exc})"


# ---------------------------------------------------------------------------
# The corpus, the rich store, and the stores rebuilt from them.
# ---------------------------------------------------------------------------


def unfold(text: str) -> str:
    return re.sub(
        r"@@golden-asset ([0-9a-f]{64})@@",
        lambda m: (GOLDEN / "assets" / m.group(1)).read_text(),
        text,
    )


def rebuild(store: str, root: Path, name: str | None = None) -> Path:
    """A storage directory holding the fixture's recorded database."""

    storage = root / (name or store) / "storage"
    storage.mkdir(parents=True)
    db = sqlite3.connect(storage / "memory.db")
    try:
        db.executescript((GOLDEN / store / "memory.sql").read_text())
        db.commit()
    finally:
        db.close()
    if store == "materializer":
        (storage / "workspace_path").write_text("/example/FictionalProject\n")
    return storage


def golden_page(store: str, page: str) -> str | None:
    path = GOLDEN / store / "html" / f"{page}.html"
    return unfold(path.read_text()) if path.is_file() else None


SHA = "0e5ac6940690be78954049d81682906deb671336"
SHA2 = "7f3c9a1d5b2e4c6a8d0f1b3e5a7c9d2f4b6e8a0c"
WHEN = "2026-11-12 09:30:00"
LATER = "2026-11-13 14:05:00"


def drop_triggers(db: sqlite3.Connection) -> None:
    """The store's immutability triggers, which would refuse the seeds and the edits made here."""

    for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'").fetchall():
        db.execute(f'DROP TRIGGER "{name}"')


def seed_rich(storage: Path) -> None:
    """Add what the corpus lacks to the `lens` store, so every branch of the family prints."""

    db = sqlite3.connect(storage / "memory.db")
    try:
        drop_triggers(db)
        cur = db.cursor()

        def finding(fid: str, sid: str, sev: str, status: str, symptom: str, cause: str, context: str | None, sha: str | None) -> None:
            cur.execute(
                "INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity, status,"
                " business_context, ref_sha, session_id, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'p9', ?, ?)",
                (fid, sid, symptom, cause, sev, status, context, sha, WHEN, WHEN),
            )

        def evidence(path: str, symbol: str | None, lines: str | None, kind: str, note: str | None) -> int:
            cur.execute(
                "INSERT INTO evidence (file_path, symbol, line_range, ref_sha, kind, note, session_id, collected_at)"
                " VALUES (?, ?, ?, ?, ?, ?, 'p9', ?)",
                (path, symbol, lines, SHA2, kind, note, WHEN),
            )
            return int(cur.lastrowid or 0)

        def event(fid: str, state: str, loc: str | None, sha: str | None, ev: int | None, why: str, session: str | None, at: str) -> None:
            cur.execute(
                "INSERT INTO finding_resolution_events (finding_id, resolution_state, fix_location, fix_sha, evidence_id,"
                " rationale, session_id, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (fid, state, loc, sha, ev, why, session, at),
            )

        e1 = evidence("src/agreed.ts", "flush", "40-52", "code-verified", "The test replays the crash.\nIt now passes.")
        e2 = evidence("src/elsewhere.ts", None, None, "test-observed", None)
        e3 = evidence("src/agreed.ts", None, "9", "contract-stated", "The contract names the winner.")

        finding("B02-3", "B-02", "MEDIUM", "fixed", "A write is lost after a restart. The log is replayed twice.\n\nA second paragraph names B-01.", "The cursor is saved too early.", "A lost write is a lost order.", SHA)
        finding("B02-4", "B-02", "HIGH", "ruled-out", "The writer | blocks forever.", "None: the lock is released in a finally block.", None, SHA)
        finding("B03-1", "B-03", "LOW", "fixed", "Queue depth lags by one.", "The counter is bumped late.", "", SHA)
        finding("B03-2", "B-03", "CRITICAL", "ruled-out", "A claim nobody wrote down a reason for.", "Unknown.", "Operators read it.", None)
        finding("B03-3", "B-03", "MEDIUM", "confirmed-acceptable", "Keys fold to lower case.", "By design.", None, SHA)
        finding("B01-2", "B-01", "HIGH", "confirmed-bug", "A repair that was later defeated.", "The fix was reverted.", None, SHA)
        finding("B01-3", "B-01", "LOW", "ruled-out", "A dismissal with a reason and no session.", "The path is dead code.", None, None)
        event("B02-3", "fixed-pending-verification", "src/writer.ts", SHA, None, "Moved the save after the acknowledgement.", "p9", WHEN)
        event("B02-3", "verified-fixed", "src/writer.ts", SHA2, e1, "Verified against the replay test.", "p10", LATER)
        event("B02-4", "ruled-out", None, None, None, "The lock is released in a `finally` block, so it cannot hang.", "p10", LATER)
        event("B03-1", "fixed-pending-verification", "src/queue.ts", SHA, None, "", None, WHEN)
        event("B03-1", "verified-fixed", "src/queue.ts", SHA2, e2, "Checked by running the suite.", None, LATER)
        event("B03-3", "accepted", None, None, None, "", "p10", LATER)
        event("B01-2", "verified-fixed", "src/reader.ts", SHA, e3, "Verified.", "p9", WHEN)
        event("B01-2", "open", None, None, None, "The fix was reverted in a later commit.", "p10", LATER)
        event("B01-3", "ruled-out", None, None, None, "The path is dead code, so no caller reaches it.", None, LATER)
        for fid, prev, sev, why, sha, session in (
            ("B02-3", "HIGH", "MEDIUM", "The loss needs a crash mid-write.", SHA, "p9"),
            ("B01-2", "LOW", "HIGH", "It repeats on every restart.", SHA2, None),
        ):
            cur.execute(
                "INSERT INTO finding_severity_events (finding_id, previous_severity, severity, rationale, at_sha, session_id, recorded_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (fid, prev, sev, why, sha, session, LATER),
            )
        cur.execute(
            "INSERT INTO carry_runs (id, source_kind, source_path, archived_store_id, archived_anchor, reason,"
            " expected_count, imported_count, session_id) VALUES (1, 'store', '/old/memory.db', 'old-store', ?, 'carry', 5, 5, 'p9')",
            (SHA,),
        )
        carried = (
            ("C-1", "B-02", "HIGH", "An old defect that became a new one. It had two sentences.\n\nA second paragraph naming B-02 and SM-1.", "The old cause.", "open", "successor-finding", "B02-3", None, "Re-found here."),
            ("C-2", "B-03", "MEDIUM", "An old defect with a successor this store lost.", "", "open", "successor-finding", "B99-1", None, "Moved to another store."),
            ("C-3", "B-01", "LOW", "An old defect ruled out here.", "A cause.", "open", "ruled-out", None, None, "The code was removed."),
            ("C-4", "B-02", "HIGH", "An old defect repaired here.", "A cause.", "fixed-pending-verification", "repaired", None, SHA2, "Repaired at the commit."),
            ("C-5", "B-04", "CRITICAL", "A terminal one carried as it was.", "A cause.", "accepted", "archived-terminal", None, None, "Terminal in the archive."),
            ("C-6", "B-01", "LOW", "A carried defect nobody has decided.", "A cause.", "open", None, None, None, ""),
        )
        for index, (aid, sid, sev, symptom, cause, archived, outcome, successor, repaired, why) in enumerate(carried, start=1):
            cur.execute(
                "INSERT INTO carried_findings (carried_id, archived_finding_id, archived_store_id, archived_anchor_sha, subsystem_id,"
                " severity, symptom, root_cause, carry_run_id, archived_resolution, carried_by_session)"
                " VALUES (?, ?, 'old-store', ?, ?, ?, ?, ?, 1, ?, 'p9')",
                (index, aid, SHA, sid, sev, symptom, cause, archived),
            )
            if outcome:
                cur.execute(
                    "INSERT INTO carried_finding_outcomes (carried_id, outcome, successor_id, repaired_sha, rationale, session_id, ref_sha)"
                    " VALUES (?, ?, ?, ?, ?, 'p10', ?)",
                    (index, outcome, successor, repaired, why, SHA2),
                )
        contradictions = (
            (1, "B02-3", "B02-4", "src/writer.ts@abc", "classification-conflict", "a-supersedes-b", None, LATER),
            (2, "B03-1", "B03-2", None, "severity | conflict", "scope-distinction", "Reads differ by tenant.", LATER),
            (3, "B01-2", "B01-3", "src/reader.ts", "classification-conflict", "b-supersedes-a", None, None),
            (4, "B01-1", "B01-2", "src/cache.ts", "severity-conflict", "unresolved", None, None),
            (5, "B02-4", "B03-3", None, "classification-conflict", "scope-distinction", "The scope note stands in for an account.", WHEN),
        )
        for cid, fa, fb, loc, kind, resolution, note, resolved in contradictions:
            cur.execute(
                "INSERT INTO contradictions (id, finding_a, finding_b, shared_location, conflict_type, detected_at, resolution, scope_note, resolved_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (cid, fa, fb, loc, kind, WHEN, resolution, note, resolved),
            )
        for cid, resolution, note, ev, why, session, at in (
            (1, "a-supersedes-b", None, e1, "The replay test shows the log is replayed.", "p10", LATER),
            (2, "scope-distinction", "Reads differ by tenant.", e2, "Both hold, for different tenants. A | in it.", None, LATER),
            (4, "unresolved", None, None, "Nobody has looked yet.", "p9", WHEN),
        ):
            cur.execute(
                "INSERT INTO contradiction_resolution_events (contradiction_id, resolution, scope_note, evidence_id, rationale, session_id, recorded_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (cid, resolution, note, ev, why, session, at),
            )
        for cat, sid, question, blocked, resolution, answer, resolved in (
            ("domain-knowledge", "B-02", "Is a lost write acceptable?", "A severity call, B-02 included.", "answered", "No. Treat it as high, since it bills a customer.", LATER),
            ("scope-judgment", None, "Is the vendor tree in scope?", None, "dismissed", None, None),
            ("contradiction", "B-01", "Which reading holds | for B-01?", "The merge of two pages.", "superseded", "Superseded by SM-1.", WHEN),
            ("tooling-limit", None, "Could not run the suite.", None, "open", None, None),
        ):
            cur.execute(
                "INSERT INTO open_questions (category, subsystem_id, question, what_blocked, resolution, answer, created_at, resolved_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (cat, sid, question, blocked, resolution, answer, WHEN, resolved),
            )
        for cat, observation, location, follow_up in (
            ("candidate-concern", "Clock skew could reorder rows in B-02.\nSee CC-1.", "src/clock.ts", "B02-3"),
            ("anomaly", "A `retry` loop with no bound | here.", None, "dismissed"),
            ("pattern", "Every reader checks twice.", "B-01", "open"),
            ("tension", "A lead with no follow-up recorded.", None, None),
        ):
            cur.execute(
                "INSERT INTO field_notes (category, observation, location, follow_up, created_at) VALUES (?, ?, ?, ?, ?)",
                (cat, observation, location, follow_up, WHEN),
            )
        for sid, intent, started, ended, outcome in (
            ("p9", "survey B-01", WHEN, LATER, "completed"),
            ("p10", "refresh | resolve", LATER, None, None),
            ("p11", "adversarial-sweep", "2026-11-14 08:00:00", "2026-11-14 09:00:00", "deferred | later"),
        ):
            cur.execute(
                "INSERT OR REPLACE INTO sessions (session_id, intent, started_at, ended_at, outcome) VALUES (?, ?, ?, ?, ?)",
                (sid, intent, started, ended, outcome),
            )
        for run, mode, state, coverage, content, at in (
            ("v-1", "readback", 1, 1, 1, LATER),
            ("v-2", "clean-publish", 0, 1, 1, "2026-11-14 10:00:00"),
            ("v-3", "readback", 1, 0, 0, "2026-11-14 11:00:00"),
        ):
            cur.execute(
                "INSERT INTO projection_verification_runs (run_id, output_dir, mode, source_sha, state_ok, coverage_ok, content_ok, ok,"
                " summary_json, session_id, verified_at) VALUES (?, '/out', ?, ?, ?, ?, ?, ?, '{}', 'p10', ?)",
                (run, mode, SHA, state, coverage, content, int(state and coverage and content), at),
            )
        for run, status, base, head, provider, model, error, created, completed, projection in (
            ("r-1", "completed", SHA, SHA2, "anthropic", "model-a", None, LATER, "2026-11-13 15:00:00", "v-1"),
            ("r-2", "failed", SHA2, "1111111111111111111111111111111111111111", "local", "model-b", "The provider refused.", "2026-11-14 12:00:00", None, None),
            ("r-3", "planned", SHA, "2222222222222222222222222222222222222222", "anthropic", "model-a", None, "2026-11-14 13:00:00", None, None),
        ):
            cur.execute(
                "INSERT INTO refresh_runs (run_id, replicate_id, status, base_sha, head_sha, allowed_sources, provider_allowlist,"
                " selected_provider, model, runtime, determinism_mode, runtime_input_json, relation_discovery_mode,"
                " max_relation_depth, authority_mode, allowed_write_prefixes, allowed_side_effects, auto_dispatch,"
                " max_concurrency, max_attempts_per_obligation, max_tokens_per_attempt, max_total_tokens,"
                " max_total_cost_microusd, planned_tokens_per_attempt, planned_cost_microusd, output_dir, manifest_json,"
                " manifest_hash, impact_run_id, projection_run_id, session_id, error, created_at, completed_at)"
                " VALUES (?, 'rep', ?, ?, ?, '[]', '[]', ?, ?, 'rt', 'provider-default', '{}', 'explicit-only', 1,"
                " 'observe-only', '[]', '[]', 0, 1, 1, 10, 10, 10, 10, 10, '/out', '{}', 'h', ?, ?, 'p10', ?, ?, ?)",
                (run, status, base, head, provider, model, f"imp-{run}", projection, error, created, completed),
            )
        db.commit()
    finally:
        db.close()


def _delete(storage: Path, tables: tuple[str, ...]) -> None:
    db = sqlite3.connect(storage / "memory.db")
    try:
        db.execute("PRAGMA foreign_keys = OFF")
        drop_triggers(db)
        for table in tables:
            db.execute(f"DELETE FROM {table}")
        db.commit()
    finally:
        db.close()


def seed_bare(storage: Path) -> None:
    """Remove every record the family reads from the `lens` store: each page prints its empty state."""

    _delete(
        storage,
        (
            "finding_resolution_events", "finding_severity_events", "contradiction_resolution_events", "contradictions",
            "carried_finding_outcomes", "carried_findings", "findings", "evidence", "open_questions", "field_notes",
            "refresh_runs", "projection_verification_runs", "sessions",
        ),
    )


def seed_questions(storage: Path) -> None:
    """The rich store with no closed lead, no refresh run and no read-back: sessions and questions alone."""

    seed_rich(storage)
    db = sqlite3.connect(storage / "memory.db")
    try:
        db.execute("DELETE FROM field_notes WHERE COALESCE(follow_up,'open')<>'open'")
        db.commit()
    finally:
        db.close()
    _delete(storage, ("refresh_runs", "projection_verification_runs"))


def seed_leads(storage: Path) -> None:
    """The rich store with no settled question and no session: closed leads and read-backs alone."""

    seed_rich(storage)
    db = sqlite3.connect(storage / "memory.db")
    try:
        db.execute("DELETE FROM open_questions WHERE resolution IN ('answered','dismissed','superseded')")
        db.commit()
    finally:
        db.close()
    _delete(storage, ("refresh_runs", "sessions"))


def publish_instrumented(storage: Path, output: Path) -> tuple[dict[str, Any], list[str]]:
    """Publish in this process, recording the page path of each Markdown parse."""

    hp, error = load("legacy_prose")
    if hp is None:
        raise RuntimeError(error)
    import materialize  # noqa: PLC0415 — the CLI module, run in this process

    calls: list[str] = []
    real = hp._LegacyParser.parse

    def counting(self: Any, markdown: str) -> Any:
        calls.append(self.current_html_path)
        return real(self, markdown)

    hp._LegacyParser.parse = counting
    saved = sys.argv
    sys.argv = ["materialize.py", "--storage", str(storage), "--output", str(output), "--allow-external-output"]
    buffer = io.StringIO()
    try:
        with contextlib.redirect_stdout(buffer):
            code = materialize.main()
    finally:
        sys.argv = saved
        hp._LegacyParser.parse = real
    lines = [line for line in buffer.getvalue().splitlines() if line.strip()]
    summary = json.loads(lines[-1]) if lines else {}
    summary["exit"] = code
    return summary, calls


def axes_green(summary: dict[str, Any]) -> str | None:
    readback = summary.get("readback") or {}
    axes = readback.get("axes") or {}
    red = [axis for axis in ("state", "coverage", "content") if not (axes.get(axis) or {}).get("ok")]
    if summary.get("exit") != 0 or not summary.get("ok") or red:
        first = (readback.get("mismatches") or [{}])[0]
        return f"publish not green: exit {summary.get('exit')}, axes {red or 'ok'}, {json.dumps(first)[:200]}"
    return None


def start_tree(into: Path) -> Path | None:
    """The materializer as it was when this packet started, extracted from git."""

    archive = subprocess.run(
        ["git", "-C", str(REPO), "archive", START_SHA, "materializer"], capture_output=True
    )
    if archive.returncode != 0 or not archive.stdout:
        return None
    tarball = into / "start.tar"
    tarball.write_bytes(archive.stdout)
    if subprocess.run(["tar", "-xf", str(tarball), "-C", str(into)], capture_output=True).returncode != 0:
        return None
    tree = into / "materializer"
    if not (tree / "materialize.py").is_file():
        return None
    return tree if repair_start_tree(tree) is None else None


# The start tree printed a code span inside a link label as its stash placeholder
# (slice-S3 review F1); the tree before the slice printed `<code>` inside the link.
# The reference is the start tree with that one repair, each edit applied exactly once,
# and with the one text the survey-scope lane changed on purpose (SC6: what `excluded` means),
# so the comparison holds every other byte to what the packet started from.
START_TREE_REPAIRS: tuple[tuple[str, str, str], ...] = (
    (
        "page.py",
        "    external: bool = False\n",
        "    external: bool = False\n    children: tuple = ()\n",
    ),
    (
        "prose.py",
        '        return keep(Link(href, _plain(match.group(1)), href.startswith(("http://", "https://"))))\n',
        '        parts = re.split(r"\\x00(\\d+)\\x00", _plain(match.group(1)))\n'
        "        children = tuple(stash[int(p)] if n % 2 else Text(p) for n, p in enumerate(parts) if n % 2 or p)\n"
        '        label = "".join(c.value if isinstance(c, Chip) else getattr(c, "text", "") for c in children)\n'
        '        external = href.startswith(("http://", "https://"))\n'
        "        return keep(Link(href, label, external, children if len(parts) > 1 else ()))\n",
    ),
    (
        "vocabulary.py",
        '"meaning": "A ledger row classifies the path as generated, vendored, irrelevant, or deferred with a recorded reason.",',
        '"meaning": "The path is outside the survey set (an owner rule, the repository\'s ignore files, or meta sorting), or a ledger row inside it classifies the path as generated, vendored, irrelevant, or deferred with a recorded reason.",',
    ),
    (
        "html_projection.py",
        "{html.escape(node.label)}</a>'\n",
        "{''.join(html.escape(c.text) if isinstance(c, Text) else _inline_html(c) for c in node.children or (Text(node.label),))}</a>'\n",
    ),
)


def repair_start_tree(tree: Path) -> str | None:
    for name, old, new in START_TREE_REPAIRS:
        path = tree / "amanuensis_materializer" / name
        text = path.read_text() if path.is_file() else ""
        if text.count(old) != 1:
            return f"{name} at {START_SHA[:12]} does not hold the F1 site exactly once"
        path.write_text(text.replace(old, new))
    return None


def run_start_tree(tree: Path, storage: Path, output: Path) -> bool:
    proc = subprocess.run(
        [sys.executable, str(tree / "materialize.py"), "--storage", str(storage), "--output", str(output),
         "--allow-external-output"],
        capture_output=True,
        text=True,
        cwd=tree,
    )
    return proc.returncode == 0 and (output / "index.html").is_file()


def differs(got: str, wanted: str) -> str:
    at = next((i for i, (a, b) in enumerate(zip(got, wanted, strict=False)) if a != b), min(len(got), len(wanted)))
    return f"differs at byte {at}: {got[at:at + 70]!r} for {wanted[at:at + 70]!r}"


# ---------------------------------------------------------------------------
# The checks.
# ---------------------------------------------------------------------------

# What each seeded store must print, so the seed provably reaches the branch it was made for.
REACH: dict[str, dict[str, tuple[str, ...]]] = {
    "rich": {
        "resolved-findings": (
            "Terminal without a recorded basis", "authorized-dismissal", "Carried obligations", "which this store does not hold",
            "repaired at", "Verified", "Ruled out", "Accepted", "evidence-code-verified", "src/elsewhere.ts",
        ),
        "resolution-history": ("→", "Judged at", "Scopes:", "No account was recorded with this event.", "not recorded"),
        "resolved-leads": ("Questions", "Leads", "No answer is recorded.", "not recorded", "dismissed"),
        "sessions": ("not closed", "not completed", "Publication read-back", "green", "red"),
        "contradictions": ("Settled", "No account of the resolution is recorded.", "The scope note stands in for an account."),
    },
    "bare": {
        "resolved-findings": ("No finding has reached a terminal state",),
        "resolution-history": ("No resolution event is recorded",),
        "resolved-leads": ("No question has been settled and no lead has been closed",),
        "sessions": ("Nothing is recorded as having run against this conspectus",),
        "contradictions": ("No disagreement between findings has been settled",),
    },
    "questions": {
        "resolved-leads": ("No lead has been closed.",),
        "sessions": ("No refresh run is recorded.", "No publication read-back is recorded"),
    },
    "leads": {
        "resolved-leads": ("No question has been answered, dismissed, or superseded.",),
        "sessions": ("No survey session is recorded.", "No refresh run is recorded."),
    },
}

# One edit to the rich store each, the page that must change for it, and the word that must appear.
MUTATIONS: tuple[tuple[str, str, str, str], ...] = (
    ("a dismissal's rationale", "resolved-findings", "UPDATE finding_resolution_events SET rationale='Zq basis zq.' WHERE finding_id='B02-4'", "Zq basis zq."),
    ("a repair's evidence note", "resolved-findings", "UPDATE evidence SET note='Zq note zq.' WHERE file_path='src/agreed.ts' AND symbol='flush'", "Zq note zq."),
    ("a carried record's symptom", "resolved-findings", "UPDATE carried_findings SET symptom='Zq carried zq.' WHERE archived_finding_id='C-3'", "Zq carried zq."),
    ("a finding event's session", "resolution-history", "UPDATE finding_resolution_events SET session_id='zq-session' WHERE finding_id='B01-3'", "zq-session"),
    ("a severity re-grade's rationale", "resolution-history", "UPDATE finding_severity_events SET rationale='Zq regrade zq.' WHERE finding_id='B02-3'", "Zq regrade zq."),
    ("a contradiction event's rationale", "resolution-history", "UPDATE contradiction_resolution_events SET rationale='Zq event zq.' WHERE contradiction_id=1", "Zq event zq."),
    ("a settled question's answer", "resolved-leads", "UPDATE open_questions SET answer='Zq answer zq.' WHERE resolution='answered'", "Zq answer zq."),
    ("a closed lead's observation", "resolved-leads", "UPDATE field_notes SET observation='Zq lead zq.' WHERE follow_up='B02-3'", "Zq lead zq."),
    ("a survey session's outcome", "sessions", "UPDATE sessions SET outcome='Zq outcome zq.' WHERE session_id='p9'", "Zq outcome zq."),
    ("a refresh run's provider", "sessions", "UPDATE refresh_runs SET selected_provider='zq-provider' WHERE run_id='r-1'", "zq-provider"),
    ("a settled contradiction's locus", "contradictions", "UPDATE contradictions SET shared_location='zq/locus.ts' WHERE id=1", "zq/locus.ts"),
)


def main() -> int:
    page_mod, page_error = load("page")

    def corpus_present() -> str | None:
        if not (GOLDEN / "VERSION").is_file():
            return "the golden corpus has no VERSION"
        missing = [f"{store}/{page}" for store in STORES for page in FAMILY if golden_page(store, page) is None]
        return f"golden pages are absent: {missing[:4]}" if missing else None

    check("the golden corpus holds the family's pages for every store fixture", corpus_present)

    with tempfile.TemporaryDirectory(prefix="amanuensis-so17-") as tmp:
        root = Path(tmp)
        runs: dict[str, tuple[Path, Path, dict[str, Any], list[str]]] = {}
        seeds: dict[str, Callable[[Path], None]] = {
            "rich": seed_rich, "bare": seed_bare, "questions": seed_questions, "leads": seed_leads,
        }
        names = (*STORES, *seeds)

        def publish_all() -> str | None:
            for store in names:
                source = store if store in STORES else "lens"
                if not (GOLDEN / source / "memory.sql").is_file():
                    return f"{source}: the golden corpus has no memory.sql"
                storage = rebuild(source, root, store)
                if store in seeds:
                    seeds[store](storage)
                output = root / store / "docs"
                summary, calls = publish_instrumented(storage, output)
                runs[store] = (storage, output, summary, calls)
            return None

        check("every store fixture and every seeded store rebuilds and publishes", publish_all)

        def green() -> str | None:
            for store, (_storage, _output, summary, _calls) in runs.items():
                reason = axes_green(summary)
                if reason:
                    return f"{store}: {reason}"
            return None if len(runs) == len(names) else "not every store was published"

        check("each publication reads back green on all three axes", green)

        def seeds_reach() -> str | None:
            for store, pages in REACH.items():
                if store not in runs:
                    return f"{store} was not published"
                for page, words in pages.items():
                    text = (runs[store][1] / f"{page}.html").read_text()
                    absent = [word for word in words if word not in text]
                    if absent:
                        return f"{store}/{page}.html does not print {absent}, so the seed misses its branch"
            return None

        check("the seeded stores reach the branches they were made for", seeds_reach)

        def no_parse() -> str | None:
            if len(runs) != len(names):
                return "not every store was published"
            blind = 0
            for store, (_storage, _output, _summary, calls) in runs.items():
                called = sorted({path for path in calls if path[:-5] in FAMILY})
                if called:
                    return f"{store}: the Markdown parser ran while building {called}"
                blind += len(calls)
            return None if blind >= 20 else f"the counter saw {blind} parses of other pages, so it is not counting"

        check("no family page is built by the Markdown parser, and the counter counts the others", no_parse)

        def golden_equal() -> str | None:
            for store in STORES:
                if store not in runs:
                    return "not every store was published"
                output = runs[store][1]
                for page in FAMILY:
                    wanted = golden_page(store, page)
                    path = output / f"{page}.html"
                    if wanted is None or not path.is_file():
                        return f"{store}/{page}.html is missing"
                    if path.read_text() != wanted:
                        return f"{store}/{page}.html {differs(path.read_text(), wanted)}"
            return None

        check("every family page of every golden store is reproduced byte for byte", golden_equal)

        def start_equal() -> str | None:
            with tempfile.TemporaryDirectory(prefix="amanuensis-so17-start-") as old:
                tree = start_tree(Path(old))
                if tree is None:
                    return f"the tree at {START_SHA[:12]} cannot be extracted from git"
                for store in ("lens", *seeds):
                    if store not in runs:
                        return f"{store} was not published"
                    source = store if store in STORES else "lens"
                    storage = rebuild(source, Path(old), store)
                    if store in seeds:
                        seeds[store](storage)
                    before = Path(old) / store / "docs"
                    if not run_start_tree(tree, storage, before):
                        return f"the tree this packet started from did not publish the {store} store"
                    after = runs[store][1]
                    files = sorted(
                        {str(p.relative_to(before)) for p in before.rglob("*") if p.is_file() and p.suffix in (".html", ".js") and not lineage_style.is_style_asset(str(p.relative_to(before if p.is_relative_to(before) else after)))}
                        | {str(p.relative_to(after)) for p in after.rglob("*") if p.is_file() and p.suffix in (".html", ".js") and not lineage_style.is_style_asset(str(p.relative_to(before if p.is_relative_to(before) else after)))}
                    )
                    for name in FAMILY:
                        if f"{name}.html" not in files:
                            return f"{store} publishes no {name}.html"
                    for name in files:
                        a, b = after / name, before / name
                        if not a.is_file() or not b.is_file():
                            return f"{store}/{name} is published by only one of the two trees"
                        if lineage_style.current(unmarked(a.read_text())) != lineage_style.start(b.read_text()):
                            return f"{store}/{name} {differs(lineage_style.current(unmarked(a.read_text())), lineage_style.start(b.read_text()))}"
            return None

        check("the lens, rich, bare and partial stores print what the packet's start tree prints for them", start_equal)

        def renderers_return_pages() -> str | None:
            if page_mod is None:
                return page_error
            core, error = load("core")
            renderers, error2 = load("renderers")
            if core is None or renderers is None:
                return error or error2
            if "rich" not in runs:
                return "the rich store was not published"
            storage = runs["rich"][0]
            conn = core.open_ro(storage / "memory.db")
            try:
                for page, fn in (
                    ("resolved-findings", renderers.render_resolved_findings),
                    ("resolution-history", renderers.render_resolution_history),
                    ("resolved-leads", renderers.render_resolved_leads),
                    ("sessions", renderers.render_sessions),
                    ("contradictions", renderers.render_contradictions),
                ):
                    model, sources = fn(conn, storage)
                    if not isinstance(model, page_mod.Page):
                        return f"the renderer of {page} returns {type(model).__name__}, not a Page"
                    if model.path != f"{page}.html":
                        return f"the Page of {page} has the path {model.path!r}"
                    if not model.title or not model.blocks or not sources:
                        return f"the {page} Page has no title, no blocks or no sources"
            finally:
                conn.close()
            return None

        check("each renderer returns a Page with its title, path, blocks and sources", renderers_return_pages)

        def mutations_reach() -> str | None:
            for label, page, statement, word in MUTATIONS:
                storage = rebuild("lens", root, f"mut-{abs(hash(label))}")
                seed_rich(storage)
                db = sqlite3.connect(storage / "memory.db")
                try:
                    changed = db.execute(statement).rowcount
                    db.commit()
                finally:
                    db.close()
                if not changed:
                    return f"the edit of {label} matched no row, so the seed does not hold it"
                output = root / f"mut-{abs(hash(label))}" / "docs"
                publish_instrumented(storage, output)
                text = (output / f"{page}.html").read_text()
                if word not in text:
                    return f"{page}.html does not print {word!r} after {label} was changed"
                clean = (runs["rich"][1] / f"{page}.html").read_text()
                if text == clean:
                    return f"{page}.html is unchanged by an edit of {label}"
            return None

        check("an edit to a record the page reads changes that page", mutations_reach)

    def in_ci() -> str | None:
        text = CI_FILE.read_text() if CI_FILE.is_file() else ""
        return None if "test-store-only-convert-history.py" in text else "test.yml does not run the gate"

    check("the gate runs in CI", in_ci)

    if FAILURES:
        emit(f"GATE SO17 RED: {FAILURES[0]}"[:480])
        return 1
    emit("GATE SO17 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
